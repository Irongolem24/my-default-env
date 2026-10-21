# claude-mem 분석 (harvest 판단)

- 대상: `C:\workspace\my-default-env\.vendor\claude-mem` (Apache-2.0, v15.0.1)
- commit: `bbb337902271db56849b7645fee0f3b77b9aabf6` (2026-10-20)
- 규모: `src/` TS 약 132k LOC. 빌드 산출물 `plugin/scripts/worker-service.cjs` 3.9MB, `mcp-server.cjs` 822KB.

## 1. 개요

claude-mem은 "세션 간 기억"을 위한 **데몬 기반 압축 메모리**다. 훅이 tool call을 디스크 spool에 떨구면, 상주 worker(Bun + HTTP + SQLite + Chroma)가 별도 LLM 세션(기본 `claude-haiku-4-5`, Claude Agent SDK `query()`)으로 tool call 하나하나를 XML `<observation>`으로 요약하고, Stop마다 `<summary>`를 만든다. SessionStart에서 최근 observation 타임라인(≤10,000자)을 `additionalContext`로 주입한다.

우리(my-default-env)와의 근본 차이:
- claude-mem은 **raw를 버리고 LLM 요약만 남긴다** (SQLite에 원본 tool_input/output은 큐 단계까지만). 우리는 raw journal이 1급 시민이다.
- claude-mem의 저장소는 `~/.claude-mem/claude-mem.db` (사용자 전역, git 밖). 우리는 프로젝트 내 `.knowledge/` (git 추적, 사람이 읽는 md).
- 요약은 "AI가 기억하길 기대하지 않는다"는 철학은 같지만, 그 수단이 **백그라운드 LLM 호출(유료/쿼터)**이다. 우리는 기계적 append + 메인 세션 AI의 curation이다.

결론: **아키텍처는 가져오지 않는다. 훅 I/O 계약, payload 정규화, Windows/Codex 함정 회피 지식, 몇 개 유틸(transcript 역방향 파서, atomic write, tag strip, redaction 패턴, 이미지 payload elision, context 예산 축소 루프)만 harvest.**

## 2. 아키텍처 (파일 경로)

### 2.1 훅 등록
- Claude Code: `plugin/hooks/hooks.json`
  - `SessionStart` (matcher `startup|resume|clear|compact`): `claude-mem start` (async, worker 기동) + `hook claude-code context` (sync, 60s) + `ensure-launcher.cjs` (startup만)
  - `UserPromptSubmit`: `session-init` (15s)
  - `PreToolUse` (matcher `Read|^Bash$|^Grep$|^Glob$|...`): `file-context` — 읽으려는 파일의 과거 observation을 주입, 32KB↑ 파일 Read는 deny(“File Read Gate”)
  - `PostToolUse` + `PostToolUseFailure` (matcher `*`): `observation` (**`"async": true`**, 120s)
  - `Stop`: `summarize` (async), `SessionEnd`: `session-end` (async)
  - `Setup`: `"shell": "bash"` 로 version-check (`claude --init` 때만 실행)
  - 런타임 훅은 **exec form** `{"command":"claude-mem","args":[...]}` — shell 없이 on-PATH 컴파일 바이너리(`%LOCALAPPDATA%\claude-mem\bin\claude-mem.exe`) 호출. Windows 콘솔 창 깜빡임 제거 목적 (CHANGELOG).
- Codex: `.codex-plugin/plugin.json` / `plugin/.codex-plugin/plugin.json` → `"hooks": "./plugin/hooks/codex-hooks.json"`, `.agents/plugins/marketplace.json` (local marketplace).
  - 이벤트: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse(matcher `.*`), Stop, PostCompact.
  - 각 훅에 `command`(POSIX sh 프렐류드, 23KB짜리 JSON) + **`commandWindows`**(`node -e "..."` 한 줄로 플러그인 루트 탐색 후 `spawnSync`) 를 같이 둔다. 생성기: `src/build/hook-shell-template.ts`, `scripts/build-hooks.js`.
  - 설치: `codex plugin marketplace add <root>` + `~/.codex/config.toml`에 `[features] hooks = true`, `[plugins."claude-mem@claude-mem-local"] enabled = true` (`src/services/integrations/CodexCliInstaller.ts:225,455-470`). 최소 Codex 0.128.0.

### 2.2 훅 실행 파이프라인
`src/cli/hook-command.ts`
1. `readJsonFromStdin` (`src/cli/stdin-reader.ts`): 청크마다 JSON.parse 시도 → 완성되면 즉시 resolve (EOF 안 기다림), 30s safety timeout, TTY면 undefined.
2. `adapter.normalizeInput(raw)` → `NormalizedHookInput` (`src/cli/types.ts`).
3. `handler.execute(input)` → `HookResult`.
4. `emitModelContext(adapter, result)` — stdout은 **딱 한 번**, JSON 한 줄 + `\n`, write 콜백 대기 후 exit (`src/shared/hook-io.ts`).
5. 모든 예외 → no-op envelope + **exit 0**. "exit 2는 Claude Code가 block으로 해석 → 프롬프트 드롭/툴 거부/Stop 루프" (plan-17 #3161).
- stderr는 훅 실행 중 버퍼링 후 폐기 (3rd-party 노이즈가 transcript로 새는 것 방지, `installHookStderrBuffer`).

### 2.3 payload 필드 (어댑터가 읽는 것)
`src/cli/adapters/claude-code.ts`:
- `session_id`, `cwd`, `source`(startup/resume/clear/compact), `prompt`, `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `transcript_path`, `reason`, `agent_id`, `agent_type`, `hook_event_name`
- `PostToolUseFailure`는 `tool_response` 대신 `error`, `is_interrupt` → `{error, is_interrupt}`로 합성.
- `stop_hook_active`는 Claude Code에선 **일부러 무시** (다른 플러그인의 Stop block 때문에 요약이 영구 누락된 버그 #3168).

`src/cli/adapters/codex.ts`:
- 위 + `last_assistant_message`, `turn_id`, `stop_hook_active`(Codex는 존중), `permission_mode`, `model`. `session_id` 없으면 reject.
- Codex는 루트 세션의 `session_id`를 모든 서브에이전트 스레드에 공유 → 스레드 키는 `(session_id, agent_id)` (`src/shared/codex-compaction-gate.ts`).
- 출력: Stop 이벤트에는 `hookSpecificOutput` 금지, PreToolUse만 `permissionDecision`/`updatedInput`.

### 2.4 transcript 사용
- 훅은 transcript를 **Stop에서만** 읽는다: `last_assistant_message`가 비면 `transcript_path` JSONL을 역방향 청크 스캔해 마지막 assistant 텍스트 + model 추출 (`src/shared/transcript-parser.ts`). 256KB부터 4배씩 키워 최대 64MB 청크, 2GB transcript에서 `readFileSync` 터진 사례 대응.
- 별도 경로: `src/services/transcripts/watcher.ts`(47KB) — JSONL/zstd transcript를 tail하며 offset checkpoint를 저장해 hook 없이 이벤트 추출. 스키마는 `transcript-watch.example.json` (Codex `~/.codex/sessions` 포맷 매핑 포함).

### 2.5 hook → worker 핸드오프 (spool)
`src/shared/hook-spool.ts`, `src/cli/spool-hook-event.ts`, `src/services/worker/hook-spool-drain.ts`
- 이벤트 1건 = 파일 1개 `<kind>-<key>.json`, key = `tool_use_id`(파일명 안전 시) 또는 sha256(kind, session, payload). 재전달은 같은 파일 덮어쓰기 → dedupe.
- 순서는 본문의 `enqueuedAtEpochMs`.
- **공유 append 파일을 쓰지 않는 이유: Windows에서 동시 훅 프로세스 write interleave.** 각 파일은 `writeJsonFileAtomic`(tmp → fsync → rename, Windows EPERM/EBUSY/EACCES 재시도 10..320ms) (`src/shared/atomic-json.ts:97-128`).
- 훅은 spool 후 worker에 250ms `POST /api/spool/nudge`만 날리고 종료. worker는 boot/nudge/fs.watch/sweep으로 drain. 파싱 불가 엔트리는 `corrupt/`로 격리.

### 2.6 압축/요약 (worker)
- LLM 호출: `src/services/worker/ClaudeProvider.ts` (`@anthropic-ai/claude-agent-sdk` `query()`), 그 외 Gemini/OpenRouter/OpenAI-compat/Codex app-server provider. 기본 모델 `CLAUDE_MEM_MODEL='claude-haiku-4-5-20251001'` (`src/shared/SettingsDefaultsManager.ts:414`).
- 프롬프트: `src/sdk/prompts.ts` + mode JSON `plugin/modes/code.json` (그 외 `law-study.json`, `email-investigation.json`, 다국어 변형 다수).
  - observer는 "다른 세션을 몰래 관찰하는 기록자, 도구 없음" 역할. tool call마다 `<observed_from_primary_session><what_happened/><occurred_at/><parameters/><outcome/>` 전달.
  - 출력 스키마: `<observation><type/><title/><subtitle/><facts><fact/></facts><narrative/><concepts/><files_read/><files_modified/></observation>` 또는 `<skip_summary reason="noise"/>`.
  - type 9종: bugfix/feature/refactor/change/discovery/decision/security_alert/security_note/sensitive. concept 7종: how-it-works/why-it-exists/what-changed/problem-solution/gotcha/pattern/trade-off.
  - Stop 요약 스키마: `<summary><request/><investigated/><learned/><completed/><next_steps/><notes/></summary>`.
  - 필드당 16,000자 상한, 초과 시 head 60% / tail 30% + `<elided chars=.. original_size_chars=.. reason="oversize"/>` 마커 (`prompts.ts` `truncateObservationField`).
  - base64 이미지 블록/`data:image` URL을 형태 기반으로 제거 (`stripImagePayloads`) — 스크린샷 세션에서 비용 폭발(#3730) 대응.
  - 프롬프트 캐시 히트를 위해 mode 고정 지시문을 맨 앞, 세션별 내용은 뒤에.
- 응답 파싱/재시도: `src/sdk/parser.ts`, `src/sdk/output-classifier.ts`, `src/services/worker/agents/ResponseProcessor.ts`(1.2k LOC), `retry.ts`, `RateLimitStore.ts`(쿼터 창 추적).
- 저장: SQLite `observations`, `session_summaries` 등 (`src/services/sqlite/SessionStore.ts:1242~`), 벡터 검색은 Chroma (uv로 Python 기동).

### 2.7 SessionStart 재주입
- `src/cli/handlers/context.ts`, `src/services/context/ContextBuilder.ts`, `formatters/AgentFormatter.ts`, `ContextBudget.ts`.
- 형식(모델용): 
  ```
  # [project] recent context, <datetime>
  Mode: ...
  Legend: 🎯session 🔴bugfix ...
  Format: ID TIME TYPE TITLE
  Fetch details: get_observations([IDs]) | Search: mem-search skill
  ### <day>
  123 3:04p 🔵 <title>
  ...
  ```
  즉 **인덱스(제목 1줄) + 필요 시 MCP로 상세 fetch** 하는 progressive disclosure.
- 기본: 최근 observation 50개, full 상세 0개 (`CLAUDE_MEM_CONTEXT_OBSERVATIONS='50'`, `FULL_COUNT='0'`).
- **예산: `CONTEXT_OUTPUT_LIMIT = 10_000` 문자.** 주석: "one character over and the host replaces all of it with a stub". 초과 시 `fitContextToBudget` 축소 순서: full 상세 0 → 마지막 summary 제거 → 마지막 메시지 제거 → 세션 수 절반 → observation 수 절반 반복.
- worker가 미리 렌더한 블록을 파일 캐시(`src/shared/context-cache.ts`, 24h 만료)에 두고 훅은 파일만 읽음 → worker 죽어도 주입 가능. 시간 의존 부분은 nonce placeholder로 읽을 때 치환.
- 호스트별 SessionStart 타임아웃: claude-code 60s, codex 20s (`src/shared/host-hook-limits.ts`).
- Codex PostCompact는 `additionalContext`를 못 실음 → 마커만 찍고, 다음 SessionStart(source compact) 또는 서브에이전트의 다음 PostToolUse에서 1회 재주입 (`src/cli/handlers/post-compact.ts`, `src/shared/codex-compaction-gate.ts`). 마커 실패는 fail-open (매 tool call 반복 주입 방지).
- Codex SessionStart는 빈 결과라도 `hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:''}`가 없으면 "invalid session start JSON output"으로 거부 (#2972, `hook-command.ts buildNoOpResult`).

### 2.8 프라이버시
- `src/utils/tag-stripping.ts`: `<private>`, `<system-reminder>`, `<persisted-output>`, `<claude-mem-context>`(자기 주입분 재수집 방지) 등 균형 태그 블록 제거. 닫는 태그 없으면 보존.
- `src/utils/redaction.ts`: AWS/GitHub PAT/OpenAI/Anthropic/Slack/JWT/PEM/Stripe/Google 키 정규식, 선택적 generic `key=value` 패턴(lookbehind 공백 `\s{0,8}`로 제한—ReDoS 회피).

### 2.9 Windows 처리
- exec-form 훅 + 컴파일된 `claude-mem.exe` (콘솔 창 방지).
- worker 기동은 `Start-Process -WindowStyle Hidden` (Node detached spawn 금지), cwd를 DATA_DIR로(프로젝트 폴더 lock 방지) (`src/shared/worker-utils.ts:1423`).
- `spawn(..., {windowsHide: true})`, `where.exe`로 명령 탐색, Git Bash 탐색 체인 재현 (`src/npx-cli/utils/windows-git-bash-preflight.ts`: `CLAUDE_CODE_GIT_BASH_PATH` → Program Files → PATH의 모든 git 후보).
- rename 재시도, BOM 허용(`stripUtf8Bom`), 비ASCII(한글) 홈 경로 버그 수정 이력, HTTP 서버 종료 후 포트 해제 500ms 대기.
- CHANGELOG에 "Windows" 158회 등장 — 데몬/런처/포트/Bun 탐색이 Windows 버그의 주 원천.

## 3. 가져올 것

| # | 메커니즘 | 출처 | 방식 |
|---|---|---|---|
| 1 | **훅 이벤트 세트와 matcher**: SessionStart(startup/resume/clear/compact), UserPromptSubmit, PreToolUse, PostToolUse **+ PostToolUseFailure**, Stop, PreCompact/PostCompact, SessionEnd. raw journal은 PostToolUse/Failure에 `async: true`로 | `plugin/hooks/hooks.json` | 재구현 (구조만 참고) |
| 2 | **exec-form 훅** `{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs"]}` — shell 없이 node 직접. Windows 콘솔/Git Bash 의존 제거 | `plugin/hooks/hooks.json` ensure-launcher 항목 | 재구현 |
| 3 | **payload 정규화 테이블** (CC vs Codex 필드명, PostToolUseFailure의 `error`/`is_interrupt`, Codex `last_assistant_message`/`turn_id`, `(session_id, agent_id)` 스레드 키) | `src/cli/adapters/claude-code.ts`, `codex.ts`, `src/cli/types.ts` | 재구현 (작음, 50줄) |
| 4 | **stdin reader**: 청크마다 parse 시도, timeout, TTY 처리 | `src/cli/stdin-reader.ts` | copy-adapt (Apache 고지 유지) |
| 5 | **훅 IO 규율**: stdout JSON 1회+개행, flush 대기 후 exit, 모든 에러 exit 0 + no-op envelope, stderr 버퍼링 | `src/cli/hook-command.ts`, `src/shared/hook-io.ts` | 재구현 (원칙 채택, 코드 축약) |
| 6 | **Codex no-op SessionStart envelope** (`hookSpecificOutput` 필수), Stop에 hookSpecificOutput 금지 | `src/cli/hook-command.ts buildNoOpResult`, `adapters/codex.ts formatOutput` | 재구현 |
| 7 | **이벤트당 파일 1개 + atomic rename** (Windows 동시 append interleave 회피). 우리 journal은 append-only JSONL을 원하므로: 세션별 파일 분리(`journal/<date>/<session>.jsonl`)로 동시성 축소 + 단일 `appendFileSync` 1회 write(라인 < 수 KB). 대용량 output은 별도 blob 파일로 atomic write | `src/shared/hook-spool.ts` 헤더 주석, `src/shared/atomic-json.ts` | `renameWithWindowsRetry`/`writeJsonFileAtomic` copy-adapt, spool 구조는 재구현 |
| 8 | **transcript 역방향 청크 파서** (마지막 assistant 메시지/모델 추출, 깨진 JSONL 라인 skip) — Stop에서 "이번 턴의 결론" 기록용 | `src/shared/transcript-parser.ts` | copy-adapt |
| 9 | **필드 truncation 규칙**: 16k자, head 60/tail 30 + 명시적 elided 마커 — journal의 tool_response 저장 시 동일 규칙, 원본은 blob로 | `src/sdk/prompts.ts truncateObservationField`, `src/shared/text-truncation.ts` | 재구현 |
| 10 | **이미지 payload elision** (base64 content block/`data:image` URL → `{elided, media_type, bytes}`). 이미지 실험 프로젝트에서 필수. 우리는 elide 대신 **파일로 떨궈 LFS 경로로 치환** | `src/sdk/prompts.ts stripImagePayloads*` | copy-adapt |
| 11 | **tag strip** (`<private>` 등) + **secret redaction 정규식** — raw journal에 비밀이 git으로 들어가는 것 방지. 우리에게 더 중요(git 커밋됨) | `src/utils/tag-stripping.ts`, `src/utils/redaction.ts` `BUILTIN_REDACTION_PATTERNS` | 패턴 목록 copy-adapt, 스캐너는 단순화 |
| 12 | **SessionStart 주입 예산 10,000자 + 단계적 축소 루프** | `src/services/context/ContextBudget.ts` | 재구현 (30줄) |
| 13 | **인덱스형 주입 포맷**(1줄=ID·시간·type·제목, 상세는 별도 fetch) — 우리 `INDEX.md` 라우팅과 같은 발상. 주입은 INDEX 요약 + 최근 attempts 제목 | `src/services/context/formatters/AgentFormatter.ts` | 재구현 |
| 14 | **자기 주입분 재수집 방지 태그** (`<claude-mem-context>` strip) → 우리는 `<knowledge-context>` 태그로 감싸고 journal 기록 시 제거 | `src/utils/tag-stripping.ts` TAG_NAMES | 재구현 |
| 15 | **compaction 후 재주입**: Codex PostCompact는 컨텍스트 못 실음 → 마커 파일 → 다음 SessionStart(compact)/PostToolUse에서 1회 주입, fail-open | `src/shared/codex-compaction-gate.ts` | 재구현 |
| 16 | **observation 스키마 어휘**: type(bugfix/feature/discovery/decision/…), concept(gotcha/trade-off/problem-solution/…), facts=대명사 없는 자립 문장, files_read/files_modified. → `findings/` frontmatter 설계 참고. summary의 request/investigated/learned/completed/next_steps → `attempts/` 템플릿 섹션 | `plugin/modes/code.json`, `src/sdk/prompts.ts buildSummaryPrompt` | 어휘만 차용, 문구는 새로 작성 |
| 17 | **skip 가이드**("이미 기록한 사실의 재확인은 기록 금지", 빈 status check/설치 성공/빈 검색 skip) — curated layer 규칙에 반영. raw layer엔 적용 안 함 | `plugin/modes/code.json prompts.skip_guidance` | 문구 참고 |
| 18 | **SKIP_TOOLS 기본값** `ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion` — raw에선 기록하되 curated 후보에서 제외 | `src/shared/SettingsDefaultsManager.ts:438` | 값 차용 |
| 19 | **subagent 구분**: `agent_id`/`agent_type` 있으면 subagent. Stop 요약은 subagent에서 skip | `src/cli/handlers/summarize.ts` | 재구현 |
| 20 | **Codex 설치 절차**: `[features] hooks = true`, `[plugins."<id>"] enabled = true`, `codex plugin marketplace add`, `.agents/plugins/marketplace.json` 형식, 훅의 `commandWindows` 키 | `src/services/integrations/CodexCliInstaller.ts`, `.agents/plugins/marketplace.json`, `plugin/hooks/codex-hooks.json` | 형식 참고, 재구현 |

Apache-2.0 코드를 copy-adapt하는 파일(#4, #7, #8, #10, #11)은 파일 헤더에 원저작권·Apache-2.0 고지와 "modified" 표기를 남기고, 리포 루트에 `THIRD_PARTY_NOTICES`(claude-mem NOTICE 내용 포함)를 둔다. MIT 프로젝트 내 혼재는 허용됨.

## 4. 버릴 것과 이유

| 버릴 것 | 경로 | 이유 |
|---|---|---|
| 상주 worker 데몬 (HTTP 포트 377xx, SSE, idle-exit, supervisor) | `src/services/worker/*`, `src/supervisor/*`, `src/services/infrastructure/*` | Windows 버그의 최대 원천(포트 고스트, 콘솔 창, 폴더 lock, PID 재사용). 우리는 훅이 직접 파일 append하면 끝. |
| 백그라운드 LLM observer (tool call마다 Haiku 호출) | `ClaudeProvider.ts`(1.4k LOC), `provider-dispatch.ts`, `RateLimitStore.ts`, `retry.ts`, 5개 provider | 비용·쿼터·OAuth·스키마 드리프트(#3461) 처리에 수천 줄. 우리 철학은 raw는 기계적, curation은 메인 세션 AI(Stop 훅 block 또는 명시 skill). |
| Bun 의존 + 컴파일 런처 + 버전별 캐시 탐색 셸 프렐류드 | `bun-runner.js`, `src/launcher/*`, `hook-shell-template.ts` | bun 미설치 환경. `${CLAUDE_PLUGIN_ROOT}`가 없을 때 대비한 23KB 셸 체인은 과설계 — 우리는 node 단일 스크립트 + `CLAUDE_PLUGIN_ROOT` (Codex는 `PLUGIN_ROOT` fallback 1단계만). |
| SQLite + Chroma(uv/Python) 벡터 검색, Postgres 서버 런타임 | `src/services/sqlite`, `src/storage/*`, `src/server/*` | 사람이 읽고 git diff 되는 md가 목표. 검색은 grep/INDEX/wikilink로 충분. |
| PreToolUse File Read Gate (32KB↑ Read deny) | `src/cli/handlers/file-context.ts` | 행동 개입. eval에서도 Opus +20% 악화 사례 있음. 기록 시스템의 범위 밖. |
| MCP 서버, viewer UI, telemetry(PostHog), TeamBrain, cmem.ai 프로모, Pro gateway | `src/servers`, `src/ui`, `src/services/telemetry`, `src/shared/teambrain.ts`, `pro-promo.ts` | 범위 밖·상업 기능. |
| 10+ 호스트 어댑터 (Cursor, Kimi, Windsurf, Qoder, Antigravity, Grok, OpenCode…) | `src/cli/adapters/*`, `src/services/integrations/*` | Claude Code + Codex만. |
| transcript watcher (zstd 포함 tail + offset 체크포인트) | `src/services/transcripts/*` | 훅이 Codex에서도 동작하므로 불필요. 단, "훅이 놓친 것 backfill" 용도로 나중에 Stop 시 transcript 1회 스캔은 고려 (#8로 충분). |
| `stop_hook_active` 무시 로직 | `adapters/claude-code.ts` | 우리 Stop 훅은 curation 강제를 위해 **block할 수 있으므로** 반대로 `stop_hook_active`를 반드시 존중해 무한루프 방지해야 함. |

## 5. 우리 설계에 대한 시사점

1. **raw 기록은 "훅 = 파일 append 후 즉시 exit 0"으로 끝낸다.** 네트워크·데몬·LLM 없음. claude-mem도 결국 v15에서 "hooks save each event to disk and return at once"로 수렴했다 — 그 디스크 단계가 곧 우리 journal이다.
2. **동시성**: 병렬 subagent/tool로 PostToolUse가 동시에 뜬다. 세션별 JSONL + 라인당 단일 `appendFileSync`(O_APPEND)로 충분한지 Windows에서 실측 필요. 실패 시 claude-mem식 "이벤트당 파일 + atomic rename" 후 SessionEnd/Stop에서 병합.
3. **exit code**: 기록 훅은 절대 exit 2 금지. 단, curation 강제(Stop에서 "attempts 미작성" 시 block)는 의도적 exit 2/`decision:block`이므로 **기록 훅과 강제 훅을 별도 스크립트로 분리**하고, 강제 훅은 `stop_hook_active`로 1회만 block.
4. **SessionStart 주입 10,000자 하드 리밋** 준수. INDEX.md 상위 섹션 + 최근 attempts/findings 제목 목록 + "상세는 파일 경로로 Read" 형식. 초과 시 단계적 축소.
5. **비밀 유출 방지가 claude-mem보다 중요**(우리 journal은 git에 커밋됨). redaction을 기록 시점에 적용, `.knowledge/journal/`에 대한 pre-commit 스캔도 고려. `<private>` 태그 지원.
6. **이미지**: tool_response의 base64는 journal에 넣지 말고 `.knowledge/assets/<hash>.<ext>`로 저장(LFS) 후 경로로 치환. 생성 이미지 파일은 PostToolUse에서 `tool_input`의 경로 추출(`files_modified` 개념)로 링크.
7. **대형 출력**: 16k자 head/tail + elided 마커를 journal 라인에, 원본 전체는 blob 파일(선택). 그렇지 않으면 JSONL 하나가 수백 MB가 된다(claude-mem은 2GB transcript 사례를 겪음).
8. **Codex 호환 체크리스트**: (a) SessionStart 출력엔 항상 `hookSpecificOutput.hookEventName`, (b) Stop 출력엔 hookSpecificOutput 금지, (c) PostCompact엔 context 불가 → 마커 방식, (d) `session_id` 공유 → `agent_id`로 스레드 구분, (e) 사용자가 `[features] hooks = true` 켜야 함 — 설치 문서에 명시, (f) Windows용 `commandWindows` 키 지원 확인 후 `node` exec 사용.
9. **curated layer 스키마**는 claude-mem 어휘 차용: attempt = request/investigated/learned/completed/next_steps + params + 결과 파일; finding = type(discovery/decision/gotcha/trade-off) + 자립형 facts + files. "이미 기록한 사실의 재확인은 새 finding 금지" 규칙.
10. **복잡도 경고**: claude-mem은 132k LOC, CHANGELOG 503KB, Windows 관련 항목 158건. 원인은 데몬·런처·다중 provider·다중 호스트. 우리 목표 규모는 훅 스크립트 수백 줄 + 템플릿/skill. 의존성 0(node 내장 모듈만) 유지.

## 6. 출처

- repo: https://github.com/thedotmack/claude-mem , commit `bbb337902271db56849b7645fee0f3b77b9aabf6` (2026-10-20 15:41 -0700), 라이선스 `LICENSE`(Apache-2.0), `NOTICE`(Copyright 2026 Alex Newman)
- 훅 등록: `plugin/hooks/hooks.json`, `plugin/hooks/codex-hooks.json`, `.codex-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`
- 훅 파이프라인: `src/cli/hook-command.ts`, `src/cli/stdin-reader.ts`, `src/cli/types.ts`, `src/shared/hook-io.ts`
- 어댑터: `src/cli/adapters/claude-code.ts`, `src/cli/adapters/codex.ts`
- 핸들러: `src/cli/handlers/{observation,summarize,context,session-init,post-compact,file-context}.ts`
- spool/원자적 쓰기: `src/shared/hook-spool.ts`, `src/cli/spool-hook-event.ts`, `src/shared/atomic-json.ts`
- transcript: `src/shared/transcript-parser.ts`, `src/services/transcripts/watcher.ts`, `transcript-watch.example.json`
- 프롬프트: `src/sdk/prompts.ts`, `plugin/modes/code.json`
- LLM: `src/services/worker/ClaudeProvider.ts`, `src/shared/SettingsDefaultsManager.ts`
- 주입: `src/services/context/{ContextBudget,ContextBuilder,TokenCalculator}.ts`, `src/services/context/formatters/AgentFormatter.ts`, `src/shared/context-cache.ts`, `src/shared/host-hook-limits.ts`, `src/shared/codex-compaction-gate.ts`
- 프라이버시: `src/utils/tag-stripping.ts`, `src/utils/redaction.ts`
- Windows: `src/npx-cli/utils/windows-git-bash-preflight.ts`, `src/shared/worker-utils.ts`(~1423), `src/services/infrastructure/GracefulShutdown.ts`, `src/launcher/*`, `plugin/scripts/bun-runner.js`, `CHANGELOG.md`
- Codex 설치: `src/services/integrations/CodexCliInstaller.ts`
- DB 스키마: `src/services/sqlite/SessionStore.ts:1242`
