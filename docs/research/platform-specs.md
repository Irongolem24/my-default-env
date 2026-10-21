# Platform Specs — Claude Code 플러그인 + Codex CLI 이중 지원

조사일 2026-10-21 · 대상 버전 **Claude Code 2.1.305**, **codex-cli 0.159.3** · Windows 11 (Git Bash + PowerShell 5.1, node 24)

근거 등급: **[실측]** 이 머신에서 직접 실행하거나 바이너리에서 추출한 것 · **[문서]** 공식 문서 · **[예제]** 로컬 레퍼런스 구현 · **[추정]** 아직 검증하지 않은 것 (구현 전에 반드시 확인)

---

## 0. TL;DR (설계 결정에 직접 쓰는 사실)

1. **배포 카탈로그 하나로 두 호스트를 다 덮는다.** Codex 0.159는 `.claude-plugin/marketplace.json`과 `.claude-plugin/plugin.json`을 그대로 읽는다. [실측: 바이너리 문자열 `.agents/plugins/marketplace.json | .claude-plugin/marketplace.json | .cursor-plugin/marketplace.json`, `.codex-plugin/plugin.json | .claude-plugin/plugin.json`. 실제로 `harness-init@AIT`가 `.claude-plugin`만 가진 채 Codex에 설치돼 있음]
2. **훅 계약은 사실상 같다.** stdin은 `session_id / transcript_path / cwd / hook_event_name`, 출력은 `hookSpecificOutput.additionalContext`, Stop은 `decision:"block"` + `reason`. Codex는 이 계약을 의도적으로 복제했다. [실측: codex.exe에 내장된 draft-07 스키마 23개를 `docs/research/codex-hook-schemas-0.159.3/`로 추출]
3. **Codex의 출력 스키마는 전부 `additionalProperties:false`다.** 그래서 Claude 전용 필드를 섞으면 Codex가 출력을 `invalid ... JSON output`으로 버린다. 출력은 **교집합 형식**으로만 쓴다.
4. **Windows에서 Codex는 훅 `command`를 PowerShell로 실행한다.** [실측: `$env:PSModulePath`와 `${HOME}`은 전개됐고 `%COMSPEC%`는 리터럴로 남았으며 `$0`은 사라졌다] 반면 Claude Code는 Windows에서 Git Bash가 기본이다. 따라서 **두 셸에서 똑같이 동작하는 명령 문자열**이 필요하다. 아래 §4의 `node -e` 부트스트랩이 그 해법이다.
5. **Stop 강제는 양쪽에서 된다.** `{"decision":"block","reason":"..."}`를 쓰고, 재진입하면(`stop_hook_active:true`) 반드시 통과시킨다. 다만 Codex Stop은 `hookSpecificOutput`을 받지 못하므로 Stop에서는 additionalContext를 쓸 수 없다.
6. **Codex 훅은 신뢰 승인(trust)을 받아야 실행된다.** 승인 전 훅은 경고 없이 건너뛰고, 해시가 바뀌면 재승인이 필요하다. 설치 안내에 대화형 `/hooks` 승인 단계를 반드시 넣는다.

---

## 1. Claude Code 플러그인 스펙

### 1.1 디렉토리 레이아웃 [문서]

출처: https://code.claude.com/docs/en/plugins-reference

```
<plugin-root>/
├── .claude-plugin/plugin.json   # 선택이지만 사실상 필수. 여기엔 manifest만 둔다
├── skills/<name>/SKILL.md       # 기본 스캔 경로 (manifest `skills`는 여기에 '추가')
├── commands/*.md                # 레거시. 새 플러그인은 skills/ 권장
├── agents/*.md
├── hooks/hooks.json             # 기본 훅 파일. manifest `hooks`와 '병합'
├── .mcp.json                    # 기본 MCP. manifest `mcpServers`와 병합
├── bin/                         # Bash tool PATH에 추가됨
└── scripts/ ...                 # 훅이 부르는 스크립트 (관례)
```

- 컴포넌트 경로는 모두 `./`로 시작해야 하고 plugin root 안에 있어야 한다. `..`는 validate에서 에러가 난다.
- 설치하면 플러그인은 `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`으로 **복사**된다. 그래서 root 밖의 파일은 참조할 수 없다. [예제: `C:\Users\shing\.claude\plugins\cache\AIT\harness-init\3.0.1`]
- plugin root의 `CLAUDE.md`는 로드되지 않고 validate가 경고한다.
- `claude plugin validate <dir>`가 공식 검사기다. CI에서는 `--strict`를 쓴다.

### 1.2 `.claude-plugin/plugin.json` [문서]

`name`만 필수다. 우리에게 쓸모 있는 필드만 추렸다.

```json
{
  "name": "my-default-env",
  "displayName": "My Default Env",
  "version": "0.1.0",
  "description": "Forces journaling of every session to .knowledge/journal/ and provides curate/recall skills",
  "author": { "name": "Irongolem24", "url": "https://github.com/Irongolem24" },
  "homepage": "https://github.com/Irongolem24/my-default-env",
  "repository": "https://github.com/Irongolem24/my-default-env",
  "license": "MIT",
  "keywords": ["journal", "knowledge", "hooks", "codex"],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json"
}
```

- `name`은 kebab-case다. `claude-`, `anthropic-`, `cc-plugin-` 접두는 예약어라 에러가 난다.
- `version`을 적으면 그 값이 사용자의 고정 버전이 된다. 값을 올리지 않으면 업데이트가 배포되지 않는다.
- `hooks`: 경로, 인라인 객체, 또는 둘을 섞은 배열을 받는다. `hooks/hooks.json`은 manifest에 적지 않아도 자동으로 로드된다. 같은 파일을 manifest에 다시 적으면 중복 로드될 수 있으니 **기본 위치를 쓸 때는 `hooks` 키를 생략**하는 편이 안전하다. [추정: 중복 dedup 여부 미확인]
- `skills`: 기본 `skills/` 스캔에 더해진다.
- `commands` / `agents`: 기본 디렉토리를 **대체**한다.
- `mcpServers`, `userConfig`(`CLAUDE_PLUGIN_OPTION_<KEY>`로 훅에 export됨), `dependencies`, `defaultEnabled`도 지원한다.

### 1.3 `.claude-plugin/marketplace.json` [문서][예제]

출처: https://code.claude.com/docs/en/plugin-marketplaces · 예제 `~/.codex/.tmp/marketplaces/AIT/.claude-plugin/marketplace.json`

```json
{
  "name": "my-default-env",
  "description": "my-default-env marketplace",
  "owner": { "name": "Irongolem24" },
  "plugins": [
    {
      "name": "my-default-env",
      "source": "./plugins/my-default-env",
      "description": "Journal-everything hooks + curate/recall skills for Claude Code and Codex"
    }
  ]
}
```

- `name`, `owner`, `plugins[]`가 필수다. entry에는 `name`과 `source`가 필수다.
- **entry `name`은 plugin.json의 `name`과 같아야 한다.** 다르면 `Plugin "<x>" not found in marketplace`가 난다.
- source 형식:
  - 상대경로 `"./plugins/x"`
  - `{ "source":"github","repo":"owner/repo" }`
  - `{ "source":"git-subdir","url":"owner/repo","path":"sub" }`
  - `url`, `archive`, `npm`, `command`
- **권장: 플러그인 본체를 `plugins/my-default-env/` 하위에 둔다.** source를 `"./"`(레포 루트)로 하면 `.vendor/`와 `docs/`까지 캐시에 복사된다. AIT도 같은 레이아웃이고 Claude와 Codex 양쪽에서 실제로 동작한다. [예제]
- `claude-plugins-official` 같은 공식 마켓 이름은 예약어다.

### 1.4 Skills (SKILL.md) [문서]

출처: https://code.claude.com/docs/en/skills

```markdown
---
name: env-init
description: Initialize .knowledge/ in the current project with a profile (web|python|game...). Use when the user runs /env-init or asks to set up the default environment.
argument-hint: "<profile>"
disable-model-invocation: true
allowed-tools: Bash(node *) Read Write
---
Profile requested: $ARGUMENTS
Templates live at ${CLAUDE_PLUGIN_ROOT}/templates/ ...
```

- **호출 이름은 namespace가 붙은 `/my-default-env:env-init`이 정식이다.** bare `/env-init`은 다른 명령과 이름이 겹치지 않을 때만 동작한다. README에는 namespace 형식을 적는다.
- 치환 변수(Claude 전용):
  - `$ARGUMENTS`, `$0`, `$name`
  - `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`
  - Codex는 이 변수들을 치환하지 않는다. 함정 §7 참조.
- `description`과 `when_to_use`를 합쳐 1,536자에서 잘린다. SKILL.md는 500줄 이하로 유지한다.
- `disable-model-invocation: true`이면 자동 호출이 막힌다. `/env-init`이나 `/env-upgrade`처럼 부작용이 있는 스킬에 권장한다.

### 1.5 사용자 설치 명령 (Claude) [문서][예제]

```bash
# 셸에서
claude plugin marketplace add Irongolem24/my-default-env
claude plugin install my-default-env@my-default-env
# 또는 세션 안에서
/plugin marketplace add Irongolem24/my-default-env
/plugin install my-default-env@my-default-env
/reload-plugins
```

- 업데이트: `claude plugin marketplace update my-default-env`를 실행한 뒤 version을 올린다.
- 로컬 개발: `claude --plugin-dir ./plugins/my-default-env`, 또는 로컬 경로로 marketplace add. 로컬 경로 마켓은 캐시 복사 없이 in-place로 로드되므로 `/reload-plugins`로 바로 반영된다.

---

## 2. Claude Code 훅: 설정·페이로드·출력

출처: https://code.claude.com/docs/en/hooks

### 2.1 hooks/hooks.json 형식 [문서][예제]

```json
{
  "description": "my-default-env journaling hooks",
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact",
        "hooks": [ { "type": "command", "command": "<CMD> session-start", "timeout": 15 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "<CMD> stop", "timeout": 10 } ] }
    ]
  }
}
```

- 파일에는 반드시 최상위 `"hooks"` 래퍼가 있어야 한다. 이벤트 맵만 있으면 로드에 실패한다.
- handler 필드:
  - `type`: `command|http|mcp_tool|prompt|agent`
  - `command`
  - `args`: 있으면 exec form(셸 없음). **Claude 전용**
  - `timeout`: 초 단위
  - `async`
  - `asyncRewake`
  - `shell`: `"bash"|"powershell"`
  - `statusMessage`
  - `if`: 도구 이벤트 전용
  - `onFailure`: `continue|block`, 2.1.295 이상
- matcher: `*`, `""`, 생략은 전부 매치한다. 영숫자와 `|`만 쓰면 정확 매치 목록이고, 그 밖의 문자가 들어가면 JS regex로 해석된다.
- 기본 timeout: command는 **600s**, UserPromptSubmit은 **30s**, SessionEnd는 **전체 예산 1.5s**다. SessionEnd 예산은 hook의 `timeout`이나 `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`로 늘린다. [문서] harness-init은 `timeout:10`으로 상향했다. [예제]
- 훅 환경변수:
  - `CLAUDE_PROJECT_DIR`: 세션 시작 루트이며 worktree 안에서도 바뀌지 않는다
  - `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`: 업데이트 후에도 남는 `~/.claude/plugins/data/<id>/`
  - `CLAUDE_PLUGIN_OPTION_<KEY>`
  - `CLAUDE_ENV_FILE`: SessionStart 전용
  - `CLAUDE_EFFORT`
- `${CLAUDE_PLUGIN_ROOT}`는 `command`와 `args` 문자열 안에서 Claude가 **텍스트 치환**한다. Windows에서는 슬래시 경로로 치환된다. 셸 형식에서는 `"\"${CLAUDE_PLUGIN_ROOT}\"/scripts/x"`처럼 따옴표로 감싸라고 문서가 권장한다.
- Windows 셸: Git Bash가 있으면 bash가 기본이고, 없으면 PowerShell이다. Git Bash가 없으면 Bash tool 자체가 등록되지 않으므로 도구 matcher에는 `Bash|PowerShell`을 쓴다.

### 2.2 stdin 공통 필드 [문서]

```json
{
  "session_id": "abc123",
  "prompt_id": "550e8400-...",
  "transcript_path": "C:/Users/<u>/.claude/projects/<encoded-cwd>/<session_id>.jsonl",
  "cwd": "C:\\workspace\\proj",
  "scratchpad_dir": "...",
  "permission_mode": "default|plan|acceptEdits|auto|dontAsk|bypassPermissions",
  "effort": { "level": "high" },
  "hook_event_name": "PreToolUse",
  "agent_id": "...", "agent_type": "Explore"
}
```

`agent_id`와 `agent_type`은 서브에이전트 안에서만 들어온다.

### 2.3 이벤트별 추가 필드 [문서]

| Event | 추가 입력 | matcher 대상 |
|---|---|---|
| SessionStart | `source` (`startup\|resume\|clear\|compact\|fork`), `model`?, `session_title`? | source |
| UserPromptSubmit | `prompt` | 무시 |
| PreToolUse | `tool_name`, `tool_input`, `tool_use_id` | tool_name |
| PostToolUse | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms`? | tool_name |
| PostToolUseFailure | `tool_name`, `tool_input`, `error`, `is_interrupt`?, `duration_ms`? | tool_name |
| Stop | `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons` | 무시 |
| SubagentStop | 위 항목 + `agent_id`, `agent_type`, `agent_transcript_path` | agent_type |
| PreCompact | `trigger` (`manual\|auto`), `custom_instructions` | trigger |
| PostCompact | `trigger`, `compact_summary` | trigger |
| SessionEnd | `reason` (`clear\|resume\|logout\|prompt_input_exit\|other`) | reason |

### 2.4 출력 [문서]

공통 필드는 `continue`(false면 Claude가 완전히 정지), `stopReason`, `suppressOutput`(현재 무효과), `systemMessage`(사용자에게 경고로 표시)다. stdout은 **JSON 객체 하나뿐**이어야 하고 앞뒤에 다른 텍스트가 붙으면 안 된다.

| Event | 컨텍스트 주입 | 차단/강제 |
|---|---|---|
| SessionStart | `hookSpecificOutput.additionalContext`. plain stdout도 컨텍스트가 된다 | 없음 |
| UserPromptSubmit | additionalContext 또는 plain stdout | `decision:"block"` + `reason`, 또는 exit 2 |
| PostToolUse(/Failure) | additionalContext | `decision:"block"` + `reason` (도구는 이미 실행됨) |
| Stop / SubagentStop | additionalContext도 받는다 ("Stop hook feedback") | **`decision:"block"` + `reason`이 종료를 막는다**. exit 2 + stderr도 같다 |
| PreCompact | — | block 가능 |
| SessionEnd, PostCompact | — | 없음 (출력 무시) |

additionalContext 상한은 **10,000자**다.

**Stop 강제 예시** (Claude와 Codex 공통으로 유효):

```json
{ "decision": "block", "reason": "Journal entry for this turn is missing. Append a summary to .knowledge/journal/2026-10-21.md, then stop." }
```

- 루프 안전장치:
  - `stop_hook_active:true`이면 다시 block하지 말고 통과시킨다. OMC `persistent-mode.mjs`도 같은 규율을 따른다. [예제]
  - Claude는 Stop으로 8회 연속 계속되면 다음 block을 무시하고 턴을 끝낸다. 이 상한은 `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`으로 조정한다.

**SessionStart 주입 예시** (양쪽 공통):

```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "[my-default-env] journal: .knowledge/journal/ ..." } }
```

### 2.5 transcript 위치 [실측]

Claude transcript는 `~/.claude/projects/<cwd를 인코딩한 이름>/<session_id>.jsonl`에 있다. 경로는 payload의 `transcript_path`를 그대로 쓰는 것이 정답이다.

---

## 3. Codex CLI 스펙 (0.159.3)

### 3.1 훅 설정 위치와 신뢰 [문서][실측]

출처: https://learn.chatgpt.com/docs/hooks (developers.openai.com/codex/hooks에서 308 리다이렉트됨)

- 위치: `~/.codex/hooks.json`, `~/.codex/config.toml [hooks]`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`, 그리고 **플러그인 번들**(`hooks/hooks.json` 또는 manifest의 `hooks`).
- 모든 레이어의 훅이 다 실행되며 상위 레이어가 하위를 대체하지 않는다. 한 레이어에 `hooks.json`과 인라인 `[hooks]`를 같이 두면 경고가 난다. 경고문: `loading hooks from both … prefer a single representation for this layer` [실측: 바이너리 문자열]
- 기능 플래그: `[features] hooks = true`가 기본값이다. `codex_hooks`는 deprecated alias다. [실측: 실행 시 `deprecated: [features].codex_hooks` 경고. `codex features list`에서 `hooks stable true`, `plugin_hooks removed`(플래그가 사라졌고 기능은 상시 활성으로 보임)]
- **신뢰**:
  - 관리형이 아닌 훅은 검토와 승인을 받아야 실행된다. 승인 상태는 `config.toml`의 `[hooks.state.'<파일>:<event_snake>:<그룹idx>:<훅idx>'] trusted_hash = "..."`에 저장된다. [실측: 사용자 config.toml]
  - 미승인 훅이나 해시가 바뀐 훅은 **조용히 건너뛴다**.
  - 승인 방법은 대화형 `/hooks`다. 일회성 우회는 `--dangerously-bypass-hook-trust`다.
  - 플러그인 훅도 trust review 대상이다. [문서]
  - 바이너리에 `failed to trust materialized plugin hooks` 문자열이 있어 설치 시 자동 trust 경로가 있는 것으로 보인다. [추정: CLI `codex plugin add`가 자동 trust를 하는지 미확인]
- **신원이 배열 인덱스 기반이다.** 그룹이나 훅을 앞이나 중간에 끼워 넣으면 뒤 훅들의 신뢰가 깨진다. [예제: harness-init SKILL.md 3-2b 실증] 플러그인 `hooks.json`을 수정하면 해시가 바뀌므로 **버전업 때마다 재승인이 필요할 가능성이 높다**. [추정]
- 프로젝트 로컬 `.codex/` 레이어는 그 프로젝트가 `[projects.'c:\path'] trust_level = "trusted"`일 때만 로드된다. [문서][예제]

### 3.2 handler 필드 [실측: `struct variant HookHandlerConfig::Command with 6 elements`][문서]

```json
{ "type": "command",
  "command": "...",
  "commandWindows": "...",
  "timeout": 30,
  "async": false,
  "statusMessage": "Journaling...",
  "additionalContextLimit": 2500 }
```

- **`args`(exec form)는 없다.** command는 셸 문자열 1개다.
- `commandWindows`(TOML에서는 `command_windows`)는 Windows에서 command를 대체한다.
- 기본 timeout은 600s다. SessionEnd와 Interrupt는 기본 1s, 최대 3s다.
- `type`은 `command|mcp_tool`이다. `prompt`와 `agent`는 파싱되지만 실행되지 않는다.
- matcher는 regex다. `UserPromptSubmit`, `Stop`, `Interrupt`는 matcher를 무시한다. `apply_patch`는 `Edit|Write` matcher로도 잡힌다.
- 작업 디렉토리는 세션 cwd다.
- **Windows 실행 셸 = PowerShell.** [실측: probe 결과 `$env:PSModulePath`가 전개되고 `%COMSPEC%`는 리터럴로 남음. Windows PowerShell 5.1의 PSModulePath였다]
- `CLAUDE_PROJECT_DIR`에 해당하는 루트 치환자는 없다. 루트는 stdin의 `cwd`에서 위로 거슬러 올라가며 찾는다. [예제: harness-init `findHarnessRoot`, basic-memory docstring "Codex has no project-dir env var"]
- 플러그인 훅 환경변수: `PLUGIN_ROOT`, `PLUGIN_DATA`(Codex 고유), 그리고 호환용 `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`. [문서][실측: 바이너리]
  - `${PLUGIN_ROOT}`를 command 문자열 안에서 텍스트 치환하는지는 **미확인**이다. [추정] basic-memory Codex 플러그인은 `"uv run ... \"${PLUGIN_ROOT}/hooks/session_start.py\""`를 쓴다. 이 방식은 텍스트 치환이 일어나거나, POSIX 셸이 env를 전개할 때만 동작한다. PowerShell에서 `${PLUGIN_ROOT}`는 **env가 아니라 PS 변수**라 빈 값이 된다. 그래서 Windows에서는 env를 직접 읽는 방식이 안전하다(§4.2).
- 큰 출력: 약 2,500 토큰을 넘는 additionalContext는 `<temp>/hook_outputs/<session_id>/<uuid>.txt`로 빠지고 모델에는 미리보기만 전달된다. `additionalContextLimit: 0`이면 그대로 통과시킨다.

### 3.3 stdin 페이로드 (바이너리 내장 스키마, 모두 `additionalProperties:false`) [실측]

전체 JSON 스키마는 `docs/research/codex-hook-schemas-0.159.3/*.json`에 있다.

| Event | 필수 필드(*)와 선택 필드 |
|---|---|
| SessionStart | cwd*, hook_event_name*, model*, permission_mode*, session_id*, source* (`startup\|resume\|clear\|compact\|fork`), transcript_path* (nullable) |
| UserPromptSubmit | cwd*, model*, permission_mode*, **prompt***, session_id*, transcript_path*, **turn_id***, agent_id, agent_type |
| PreToolUse | …, tool_name*, tool_input*, tool_use_id*, turn_id* |
| PermissionRequest | …, tool_name*, tool_input*, turn_id* |
| PostToolUse | …, tool_name*, tool_input*, **tool_response***, tool_use_id*, turn_id* |
| PreCompact / PostCompact | …, trigger* (`manual\|auto`), turn_id* |
| Stop | …, **last_assistant_message*** (nullable), **stop_hook_active***, turn_id* |
| SubagentStart | …, agent_id*, agent_type*, turn_id* |
| SubagentStop | …, agent_id*, agent_type*, agent_transcript_path*, last_assistant_message*, stop_hook_active* |
| SessionEnd | cwd*, session_id*, transcript_path*, reason* (const `"other"`) |
| Interrupt | …, turn_id* (Codex 전용 이벤트) |

`permission_mode` enum은 `default|acceptEdits|plan|dontAsk|bypassPermissions`다.

**Codex에 없는 것:** `PostToolUseFailure`, `prompt_id`, `scratchpad_dir`, `effort`, PostCompact의 `compact_summary`, PreCompact의 `custom_instructions`.

**실측 SessionStart payload** (probe, 2026-10-21):

```json
{"session_id":"01a15c20-9a4e-7262-b32f-941b759ca082",
 "transcript_path":"C:\\Users\\shing\\.codex\\sessions\\2026\\10\\21\\rollout-2026-10-21T10-43-24-01a15c20-....jsonl",
 "cwd":"C:\\...\\probe\\proj","hook_event_name":"SessionStart","model":"gpt-5.5",
 "permission_mode":"bypassPermissions","source":"startup"}
```

### 3.4 출력 스키마 [실측]

| Event | 허용 키 (이 밖의 키가 있으면 invalid) |
|---|---|
| SessionStart | continue, stopReason, suppressOutput, systemMessage, hookSpecificOutput{hookEventName:"SessionStart", additionalContext} |
| UserPromptSubmit | 위 공통 필드 + decision("block"), reason, hookSpecificOutput{hookEventName, additionalContext} |
| PreToolUse | 공통 필드 + decision(`approve\|block`), reason, hookSpecificOutput{permissionDecision `allow\|deny\|ask`, permissionDecisionReason, updatedInput, additionalContext} |
| PostToolUse | 공통 필드 + decision("block"), reason, hookSpecificOutput{additionalContext, updatedMCPToolOutput} |
| **Stop** | **continue, stopReason, suppressOutput, systemMessage, decision("block"), reason. `hookSpecificOutput` 없음** |
| SubagentStop | Stop과 같음 |
| PreCompact / PostCompact | continue, stopReason, suppressOutput, systemMessage |
| Interrupt | systemMessage만 |
| SessionEnd | 출력 스키마 없음 (advisory 전용, 항상 동기 실행) |

- **Codex Stop 의미**: `decision:"block"` + `reason`을 주면 **reason이 새 user prompt가 되어** Codex가 계속 작업한다. plain-text stdout은 invalid다. `reason`이 비어 있으면 에러다: `hook returned decision:block without a non-empty reason`. [문서][실측]
- SessionStart의 plain stdout: 문서는 developer context로 추가된다고 하지만, harness-init은 0.130 시절 `hook returned invalid session start JSON output`으로 버려지는 것을 실증했다. **JSON 봉투만 쓴다.** [예제]
- exit 2 + stderr는 PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop에서 허용된다. PreToolUse에서 exit 2인데 stderr가 비어 있으면 에러다. [실측: 바이너리 문자열]

### 3.5 Codex 플러그인 [실측][문서][예제]

출처: https://developers.openai.com/plugins/build/plugins · `.vendor/claude-mem/.codex-plugin/plugin.json` · `.vendor/basic-memory/plugins/codex/`

- manifest 탐색 순서: `.codex-plugin/plugin.json`, 없으면 `.claude-plugin/plugin.json`, 그다음 `.cursor-plugin/plugin.json`. [실측: 바이너리]
- 신규 "portable" 형식은 루트의 `plugin.json` + `extensions.com.openai`다. `.codex-plugin/plugin.json`은 그 호환 overlay다. [문서]
- 훅 로딩: `hooks/hooks.json`, 또는 `plugin.json#hooks[...]`. [실측: 바이너리 문자열 `hooks/hooks.json|plugin.json#hooks[`]
  - claude-mem은 `.codex-plugin/plugin.json`에 `"hooks": "./plugin/hooks/codex-hooks.json"`을 지정하는 방식으로 Claude와 Codex 훅 파일을 분리했다. [예제]
  - manifest에 `hooks`가 있을 때 기본 `hooks/hooks.json`을 대체하는지, 병합하는지는 **미확인**이다. [추정]
- `.codex-plugin/plugin.json` 예 (basic-memory):

```json
{ "name": "codex", "version": "0.23.2", "description": "...",
  "skills": "./skills/", "mcpServers": "./.mcp.json",
  "interface": { "displayName": "Basic Memory for Codex", "category": "Developer Tools",
                 "capabilities": ["Interactive","Read","Write"], "defaultPrompt": ["..."] } }
```

- marketplace 위치: `<repo>/.agents/plugins/marketplace.json`(Codex 고유), `~/.agents/plugins/marketplace.json`, **`<repo>/.claude-plugin/marketplace.json`(레거시 호환)**.
- Codex 고유 entry 형식:

```json
{ "name": "basic-memory", "interface": { "displayName": "Basic Memory" },
  "plugins": [ { "name": "codex",
                 "source": { "source": "local", "path": "./plugins/codex" },
                 "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
                 "category": "Developer Tools" } ] }
```

- 캐시 위치는 `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`다. [실측: `~/.codex/plugins/cache/AIT/harness-init/3.0.1/` 안에는 `.claude-plugin`만 있음] git 마켓 스냅샷은 `~/.codex/.tmp/marketplaces/<name>/`에 있다.
- 활성화 기록은 `config.toml`에 남는다:
  - `[marketplaces.AIT] source_type="git" source="https://github.com/Irongolem24/AIT.git"`
  - `[plugins."harness-init@AIT"] enabled = true`

### 3.6 Codex skills [문서][실측]

출처: https://learn.chatgpt.com/docs/build-skills

- 위치:
  - REPO: `$CWD/.agents/skills`부터 레포 루트까지
  - USER: `$HOME/.agents/skills`
  - ADMIN: `/etc/codex/skills`
  - SYSTEM
  - 그리고 **플러그인 번들 `skills/`**
  - `~/.codex/skills`에도 실제로 스킬들이 있다(oh-my-codex가 설치). [실측]
- SKILL.md 형식은 Claude와 동일하다. frontmatter `name`과 `description`이 필수다. 선택적으로 `agents/openai.yaml`(`policy.allow_implicit_invocation: false`로 자동 호출 차단)을 둔다.
- 호출: 명시적으로는 `$skill-name` 또는 `/skills`, 암묵적으로는 description 매칭.
- 플러그인 스킬의 namespace 표기(`$my-default-env:env-init`인지 `$env-init`인지)는 **미확인**이다. [추정] 설치 후 `/skills`로 확인해야 한다.
- **Codex는 `$ARGUMENTS`나 `${CLAUDE_PLUGIN_ROOT}` 같은 치환을 하지 않는다.** 스킬 본문은 인자가 대화 텍스트로 들어온다는 전제로 써야 한다.
- custom prompts(`~/.codex/prompts`)는 레거시다. 슬래시 커맨드 대신 skill을 쓴다.

### 3.7 Codex transcript / rollout [실측]

- `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO ts>-<session_id>.jsonl`. payload의 `transcript_path`로 들어온다(nullable).
- 줄 형식은 `{timestamp, ordinal, type, payload}`다. type 값에는 `session_meta`, `turn_context`, `response_item:message|reasoning`, `event_msg:task_started|item_completed|token_count|task_complete`, `world_state`, `token_usage_record`가 있다.
- 새 버전은 `thread_history_1.sqlite`(paginated thread history)로 이전하는 중이다(`codex migrate-rollouts`). 그래서 **`transcript_path`가 null일 수 있다고 보고 방어 코드**를 둔다.
- `~/.codex/session_index.jsonl`에는 `{id, thread_name, updated_at}`가 있다.

### 3.8 설치 명령 (Codex) [실측: `codex plugin --help`][예제]

```bash
codex plugin marketplace add Irongolem24/my-default-env      # owner/repo[@ref], URL, 로컬 경로. --ref, --sparse 지원
codex plugin add my-default-env@my-default-env
codex plugin list
codex plugin marketplace upgrade my-default-env              # 업데이트
# 그 다음 '새' 대화형 세션에서 /hooks → my-default-env 훅 승인  (codex exec에서는 승인 불가 = 훅 미실행)
```

---

## 4. 이중 지원 전략

### 4.1 레포 레이아웃 (권장)

```
my-default-env/                       # git repo = marketplace
├── .claude-plugin/marketplace.json   # Claude와 Codex가 모두 읽는다 (단일 카탈로그)
├── plugins/my-default-env/
│   ├── .claude-plugin/plugin.json    # Claude와 Codex가 모두 읽는다
│   ├── .codex-plugin/plugin.json     # 선택. Codex 전용 interface나 별도 hooks 파일을 지정할 때만
│   ├── hooks/hooks.json              # 공용 (§4.2 명령 형식)
│   ├── hooks/run.cjs                 # 단일 디스패처 (node, deps 0)
│   ├── skills/{env-init,curate,log-attempt,recall,env-upgrade}/SKILL.md
│   └── templates/...
└── docs/ ...
```

- `.agents/plugins/marketplace.json`은 필요 없다. 호환 경로로 충분하다는 것이 AIT로 실증됐다. Codex UI용 `interface` 메타가 필요해질 때만 추가한다.

### 4.2 하나의 명령 문자열을 두 셸에서 쓰기 (핵심)

`hooks/hooks.json`의 command를 Git Bash(Claude/Win), PowerShell 5.1(Codex/Win), sh(mac/linux)가 **모두 같은 뜻으로 해석**해야 한다.

```json
{ "type": "command",
  "command": "node -e \"require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT||process.env.PLUGIN_ROOT,'hooks','run.cjs'))\" session-start",
  "timeout": 15 }
```

- 이 형식이 성립하는 이유:
  - `"…"` 안에 `$`, 역슬래시, 이중따옴표가 없다. 그래서 bash, PowerShell, cmd 어느 쪽도 내용을 바꾸지 않는다.
  - 경로는 env에서 node가 직접 읽는다. 셸 전개나 텍스트 치환에 의존하지 않는다.
  - claude-mem의 `commandWindows`가 같은 원리(`node -e` + `process.env.CLAUDE_PLUGIN_ROOT`)다. [예제]
- [실측] 같은 명령을 Git Bash(`CLAUDE_PLUGIN_ROOT` 설정)와 PowerShell 5.1(`PLUGIN_ROOT`만 설정)에서 각각 실행했고, 둘 다 `run.cjs`를 로드해 `session-start` 인자를 받았다.
- `run.cjs` 안에서는 `process.argv`의 마지막 값(`session-start`)을 보고 분기한다. 이벤트의 진짜 권위는 stdin의 `hook_event_name`이다.
- 대안 A: Claude는 `"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/hooks/run.cjs","session-start"]`(exec form)로 쓰고, Codex는 별도 파일을 `.codex-plugin/plugin.json`의 `"hooks"`로 지정한다(claude-mem 방식). 인용 안전성은 가장 좋지만 파일이 두 벌이 되고, Codex가 기본 `hooks/hooks.json`도 함께 로드하는지 확인해야 한다. [추정]
- 대안 B: `${CLAUDE_PLUGIN_ROOT}` 텍스트 치환에 의존한다. Claude는 확실하다. Codex는 PowerShell에서 `${X}`를 PS 변수로 해석하므로 **실패 위험이 있다**. 비권장.

### 4.3 호스트 판별 (run.cjs)

우선순위:

1. 명시 인자 (`--host codex`): 훅 파일을 분리한 경우에만 사용한다.
2. `process.env.PLUGIN_ROOT`가 있으면 Codex다. Codex만 설정하는 변수이고, Claude는 `CLAUDE_PLUGIN_ROOT`만 설정한다. [문서]
3. `transcript_path`가 `\.codex[\\/]sessions` 패턴이면 Codex, `\.claude[\\/]projects`이면 Claude다.
4. 페이로드 모양:
   - Claude 전용 필드 `prompt_id`, `scratchpad_dir`, `effort`가 있으면 Claude다.
   - turn 범위 이벤트에 `turn_id`가 있으면 Codex다.
   - `PostToolUseFailure` 이벤트는 Claude다.

**쓰면 안 되는 판별 수단:** `CLAUDECODE`, `CLAUDE_CODE_*` 환경변수. probe에서 Claude 세션 안에서 띄운 Codex의 훅에 `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID`가 그대로 상속된 것을 확인했다. [실측]

### 4.4 출력은 교집합 형식만

- 주입: `{"hookSpecificOutput":{"hookEventName":<stdin의 hook_event_name>,"additionalContext":"..."}}`. SessionStart와 UserPromptSubmit에서 두 호스트 모두 유효하다. PostToolUse에서도 둘 다 유효하다.
- Stop 강제: `{"decision":"block","reason":"..."}`만 쓴다. `hookSpecificOutput`을 붙이면 Codex에서 invalid가 된다.
- 무출력이 필요하면 아무것도 쓰지 않고 exit 0으로 끝낸다(가장 안전). `{"continue":true,"suppressOutput":true}`도 양쪽에서 유효하다.
- 주의: Claude는 SessionStart에 `continue`를 허용하지만 Codex PreToolUse는 `continue:false`나 `stopReason`을 받지 않는다(`PreToolUse hook returned unsupported continue:false`). 이벤트별 허용 키 표(§3.4)를 지킨다.

### 4.5 "모든 것을 기록" 이벤트 매핑

| 목적 | Claude | Codex | 비고 |
|---|---|---|---|
| 세션 시작 + 컨텍스트 주입 (최근 journal/curated 요약) | SessionStart `startup\|resume\|clear\|compact` | SessionStart (source에 compact, fork 포함) | 양쪽 JSON 봉투 |
| 사용자 프롬프트 기록 | UserPromptSubmit (`prompt`) | UserPromptSubmit (`prompt`, `turn_id`) | timeout 짧게. Claude 기본 30s |
| 도구 사용 기록 | PostToolUse + PostToolUseFailure | PostToolUse만 | `async:true` 권장 (양쪽 지원) |
| 턴 종료 시 journal 강제 | Stop `decision:block` | Stop `decision:block` (reason이 새 user prompt가 됨) | `stop_hook_active` 가드 필수. "이번 턴 journal 기록 여부"는 파일 mtime이나 marker로 판정 |
| 압축 전 체크포인트 | PreCompact | PreCompact | Codex는 additionalContext 불가 |
| 세션 종료 스냅샷 | SessionEnd (1.5s 예산, timeout 상향) | SessionEnd (기본 1s, 최대 3s) | 무거운 작업 금지. append만 한다 |

- 기계 기록(프롬프트, 도구 로그)은 훅이 직접 `.knowledge/journal/`에 append한다.
- 서사 요약은 Stop block으로 **모델에게** 쓰게 한다. harness-init의 "기계 골격 = 훅, 서사 = 모델" 분리를 그대로 가져온다.
- 대안: 강제력을 낮춘 버전은 harness-init 방식이다. UserPromptSubmit에서 "지난 턴 journal 누락" 경고를 주입한다.

---

## 5. 사용자 설치 흐름 (README에 넣을 정확한 명령)

```bash
# Claude Code
claude plugin marketplace add Irongolem24/my-default-env
claude plugin install my-default-env@my-default-env
# (세션 안이라면 /reload-plugins)
# 프로젝트에서: /my-default-env:env-init <profile>

# Codex CLI
codex plugin marketplace add Irongolem24/my-default-env
codex plugin add my-default-env@my-default-env
# 새 대화형 codex 세션 → /hooks → my-default-env 훅 Trust
# 프로젝트에서: $env-init <profile>   (실제 표기는 /skills로 확인)
```

- 요구사항: Node.js 18 이상(LTS)이 PATH에 있어야 한다. Codex Desktop은 PATH가 다를 수 있다. [예제: basic-memory README "Troubleshooting Desktop hooks"]
- Codex 첫 세션 함정:
  - 훅 승인 전에는 아무 기록도 남지 않는다.
  - `codex exec`(비대화형)에서는 승인 프롬프트가 뜨지 않는다.
  - 업데이트 후 훅 해시가 바뀌면 재승인이 필요하다. [추정]
- 업데이트:
  - Claude: `claude plugin marketplace update my-default-env`. plugin.json의 `version`을 올려야 사용자에게 반영된다.
  - Codex: `codex plugin marketplace upgrade my-default-env` 후 `codex plugin add ...`를 다시 실행하고 새 세션을 연다.

---

## 6. harness-init과 OMC에서 재사용할 패턴

### harness-init 3.0.1

경로: `C:\Users\shing\.claude\plugins\cache\AIT\harness-init\3.0.1`, 마켓 원본은 `~/.codex/.tmp/marketplaces/AIT`

- **단일 카탈로그로 두 호스트 배포**: `.claude-plugin/marketplace.json`과 `plugins/<name>/.claude-plugin/plugin.json`만으로 Claude와 Codex에 설치된다. 근거는 AIT의 `DECISIONS.md` 2026-09-07 항목("Codex가 `.claude-plugin/*`를 1급으로 인식")과 설치된 `config.toml [plugins."harness-init@AIT"]`.
- **교집합 출력 봉투**: 런타임을 추론해 분기하지 않고 `hookSpecificOutput.additionalContext` 하나만 쓴다. `hookEventName`은 stdin의 `hook_event_name`에서 그대로 가져온다(`session-tools.mjs` `emitContext`).
- **루트 탐색**: `--root`가 없으면 stdin `cwd`에서 위로 올라가며 마커(`.harness/harness.json`)를 찾는다. 못 찾으면 **무출력 exit 0**이다. 우리는 마커를 `.knowledge/`로 하면 된다. env-init 전 프로젝트에서는 훅이 아무것도 하지 않는다.
- **stdin 읽기**: TTY면 즉시 빈 값을 반환한다. 타임아웃 안전망을 두고, 파싱에 실패하면 `{}`로 처리하며, 마지막에 `process.stdin.destroy()`를 호출하고 `process.exitCode=0`으로 자연 종료한다. 이렇게 해야 stdout이 유실되지 않는다.
- **Codex Stop은 주입 불가**이므로 비차단 경고는 UserPromptSubmit으로 옮겼다.
- Codex 배선 규율:
  - 슬래시 경로만 쓴다(역슬래시는 이스케이프로 뭉개진다).
  - 같은 레이어에 hooks.json과 `[hooks]`를 함께 두지 않는다.
  - **append-only** 머지를 한다(인덱스 신원).
  - 프로젝트 trust를 미리 기입하고 이를 보고한다.
- AGENTS.md를 권위 파일로 두고 `CLAUDE.md`는 `@AGENTS.md` 한 줄 스텁으로 둔다. Codex는 AGENTS.md만 읽고 import 기구가 없다. env-init 템플릿에 그대로 적용할 수 있다.
- SessionEnd timeout 10은 Claude 1.5s 예산을 상향하는 필수 설정이다.

### OMC 4.15.7

경로: `C:\Users\shing\.claude\plugins\cache\omc\oh-my-claudecode\4.15.7`

- `hooks/hooks.json`은 모두 `node "$CLAUDE_PLUGIN_ROOT"/scripts/run.cjs "$CLAUDE_PLUGIN_ROOT"/scripts/<x>.mjs` 형식이다. 이 형식은 bash 전용이라 Codex PowerShell에서는 깨진다.
- `run.cjs`는 `process.execPath`로 자식을 spawn하고, `CLAUDE_PLUGIN_ROOT`가 낡았을 때(버전이 바뀐 캐시) 최신 버전 디렉토리를 찾아 복구한다. **플러그인 업데이트 직후 낡은 root 문제**에 대비하는 패턴으로 가져올 만하다.
- `scripts/lib/stdin.mjs`: 타임아웃 보호 `readStdin(timeoutMs)`. Windows와 Linux에서 stdin EOF 미도착으로 생기는 hang을 방지한다(issue #240, #459).
- `persistent-mode.mjs`: `stop_hook_active===true`이면 즉시 `{continue:true,suppressOutput:true}`를 반환하고, 그 밖의 경우에만 `{decision:"block",reason}`를 낸다. 파싱에 실패하면 safe-continue로 처리한다.
- wiki 스킬(`skills/wiki/SKILL.md`, `dist/hooks/wiki/session-hooks.js`):
  - 저장 구조는 `.omc/wiki/*.md`(YAML frontmatter: category, tags, updated) + 자동 유지되는 `index.md` + append-only `log.md`, `[[page]]` 상호참조다.
  - SessionStart는 index 앞 30줄만 주입한다. PreCompact는 한 줄 통계를 주입한다. SessionEnd는 비동기 큐잉으로 처리하고 foreground에서 쓰지 않는다.
  - 우리 `.knowledge/`의 `/curate`(journal을 주제 페이지로 승격)와 `/recall`(index와 키워드 검색) 구조에 그대로 쓸 수 있다.
- OMX(oh-my-codex)의 Codex 쪽은 `~/.codex/hooks.json` 전역 + 단일 디스패처 `codex-native-hook.js`(`hook_event_name`으로 분기) 구조다. 전역 파일 공유와 인덱스 신원 위험 때문에 harness-init이 이 방식을 폐기하고 프로젝트 또는 플러그인 스코프로 옮겼다.

---

## 7. 함정 모음

1. **Codex/Windows = PowerShell**. `$VAR`, `${VAR}`, `$0`은 PS 문법으로 해석되고 `%VAR%`는 전개되지 않는다. bash 문법(`[ -f ]`, `&&` in PS5.1, `export`)도 쓰면 안 된다. → `node -e "…"` + env 직접 읽기(§4.2).
2. **Claude/Windows = Git Bash**(없으면 PowerShell). bash에서 역슬래시 Windows 경로는 따옴표가 없으면 깨진다. `${CLAUDE_PLUGIN_ROOT}`는 슬래시로 치환되니 그대로 쓰면 된다.
3. **Codex command 파서는 역슬래시를 이스케이프로 해석**한다. 절대경로를 박아야 한다면 `C:/Users/...` 슬래시 표기를 쓴다. [예제] OMX는 `\"C:\\\\Program Files\\\\nodejs\\\\node.exe\"`처럼 이중 이스케이프를 쓴다.
4. **Codex 출력은 strict**(`additionalProperties:false`)다. 필드 하나만 틀려도 출력 전체가 무시된다. stdout에 디버그 출력을 섞지 말고 디버그는 stderr나 파일로 보낸다.
5. **Codex Stop / PreCompact / PostCompact는 additionalContext를 받지 않는다.** Stop에서 쓸 수 있는 것은 `decision` + `reason`뿐이다.
6. **Stop 무한 루프**: `stop_hook_active`를 반드시 확인한다. Claude에는 8회 cap이 있지만 Codex의 cap은 문서상 확인되지 않았다. "journal이 실제로 기록됐는지"를 파일 상태로 판정해 해소 가능한 조건으로만 block한다.
7. **timeout**: Claude SessionEnd는 1.5s 예산이고 Codex SessionEnd와 Interrupt는 기본 1s(최대 3s)다. SessionEnd는 append 1회로 끝낸다. UserPromptSubmit은 매 턴 실행되므로 node 기동 비용(약 50~100ms)만 감수하고 git 호출 등은 피한다. 기록 훅은 `async:true`로 둔다.
8. **stdin hang**: 타임아웃 없이 `for await (process.stdin)`을 쓰면 EOF가 오지 않을 때 영원히 멈춘다. OMC와 harness-init의 timeout 리더를 쓴다.
9. **`transcript_path`는 nullable**(Codex)이다. Claude와 Codex의 transcript JSONL 스키마가 완전히 다르므로 파싱은 호스트별 어댑터로 분리한다.
10. **Codex 훅 신뢰**: 미승인 훅은 조용히 건너뛴다. 플러그인 업데이트로 해시가 바뀌면 다시 꺼질 수 있다. [추정] 그러니 SessionStart 출력에 "기록 활성"을 표시해 사용자가 알아챌 수 있게 하고, `/env-upgrade` 스킬에 "Codex라면 /hooks 재승인" 안내를 넣는다.
11. **스킬 치환 비대칭**: `$ARGUMENTS`와 `${CLAUDE_PLUGIN_ROOT}`는 Claude만 치환한다. 스킬 본문에 "템플릿 경로: 이 SKILL.md 기준 `../../templates/`"처럼 **상대 위치**로도 적어 두고, Codex에서는 모델이 파일 위치로 찾게 한다.
12. **이름**: 플러그인 스킬의 정식 호출은 `/my-default-env:env-init`이다. Codex 표기는 설치 후 확인한다. plugin name에는 `claude` 등 예약어를 넣지 않는다.
13. **env 기반 호스트 판별 오염**: Claude 안에서 Codex를 띄우면 `CLAUDECODE` 계열 env가 상속된다(§4.3).
14. **경로 대소문자와 구분자**: Codex payload의 `cwd`와 `transcript_path`는 역슬래시 Windows 경로다(실측). Claude의 File tool 경로도 Windows에서는 역슬래시다. 비교 전에 `path.resolve`와 소문자 드라이브로 정규화한다. Codex `config.toml`의 project 키는 소문자 드라이브 + 역슬래시 + TOML 리터럴 작은따옴표다(`[projects.'c:\workspace\x']`).
15. **캐시 경로 버전 의존**: `CLAUDE_PLUGIN_ROOT`는 업데이트하면 바뀐다. 상태는 `CLAUDE_PLUGIN_DATA`/`PLUGIN_DATA` 또는 프로젝트 `.knowledge/`에만 저장한다.

---

## 8. 미확인 항목 (구현 착수 전에 probe 필요)

- [ ] Codex가 `.claude-plugin` 플러그인의 `hooks/hooks.json`을 실제로 로드하는지, 그리고 그 훅에 `PLUGIN_ROOT`와 `CLAUDE_PLUGIN_ROOT`가 둘 다 설정되는지. 로컬 마켓으로 설치해 `/hooks`에서 확인한다. config.toml이 바뀌므로 사용자 동의가 필요하다.
- [ ] Codex 플러그인 훅 command 안의 `${PLUGIN_ROOT}`를 텍스트 치환하는지.
- [ ] `.codex-plugin/plugin.json`의 `hooks`가 기본 `hooks/hooks.json`을 대체하는지, 병합하는지.
- [ ] `codex plugin add`(CLI)가 플러그인 훅을 자동 trust하는지, 버전업 시 재승인이 필요한지.
- [ ] Codex 플러그인 스킬의 호출 표기(namespace 유무).
- [ ] Claude가 manifest `"hooks":"./hooks/hooks.json"`과 기본 파일을 중복 로드하는지(그래서 생략을 권장).

---

## 출처

**공식 문서**

- Claude: https://code.claude.com/docs/en/hooks · https://code.claude.com/docs/en/plugins-reference · https://code.claude.com/docs/en/plugin-marketplaces · https://code.claude.com/docs/en/skills
- Codex: https://learn.chatgpt.com/docs/hooks · https://learn.chatgpt.com/docs/plugins · https://developers.openai.com/plugins/build/plugins · https://learn.chatgpt.com/docs/build-skills

**실측**

- `codex.exe` (`%APPDATA%\npm\node_modules\@openai\codex\...\bin\codex.exe`)에 내장된 스키마 → `docs/research/codex-hook-schemas-0.159.3/`
- 바이너리 문자열 (HookHandlerConfig, manifest/marketplace 경로, 에러 메시지)
- `codex plugin --help`, `codex features list`
- `codex exec --dangerously-bypass-hook-trust -c 'hooks.SessionStart=[...]'` probe (PowerShell 실행, payload, env 확인)
- `~/.codex/config.toml` (비밀값 제외하고 섹션만 열람)
- `~/.codex/sessions/2026/10/*/rollout-*.jsonl`

**로컬 예제**

- `C:\Users\shing\.claude\plugins\cache\AIT\harness-init\3.0.1\` (`assets/hooks/*.snippet.json`, `skills/harness-init/SKILL.md`, `assets/session-tools.mjs`)
- `~/.codex/.tmp/marketplaces/AIT/{README.md,DECISIONS.md,.claude-plugin/marketplace.json}`
- `C:\Users\shing\.claude\plugins\cache\omc\oh-my-claudecode\4.15.7\` (`hooks/hooks.json`, `scripts/run.cjs`, `scripts/lib/stdin.mjs`, `scripts/persistent-mode.mjs`, `scripts/wiki-session-start.mjs`, `skills/wiki/SKILL.md`, `dist/hooks/wiki/session-hooks.js`)
- `.vendor/claude-mem/` (`.codex-plugin/plugin.json`, `plugin/hooks/hooks.json`, `plugin/hooks/codex-hooks.json`, `.agents/plugins/marketplace.json`)
- `.vendor/basic-memory/plugins/{claude-code,codex}/`, `.vendor/basic-memory/.agents/plugins/marketplace.json`
- `~/.codex/hooks.json` (OMX 전역 디스패처)
