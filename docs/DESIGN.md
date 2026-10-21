# Design

## 문제

여러 프로젝트에서 AI와 작업하면 시행착오와 조사 내용이 대화 컨텍스트에만 남는다. "문서로 정리해"는 강제되지 않아서 AI가 잊고, 정보가 빠지면 같은 시행착오를 다시 겪는다. 반대로 문서를 무작정 늘리면 AI가 읽을 것이 너무 많아진다.

## 원칙

1. **기록은 기계가 강제한다.** 원본 층은 훅이 쓰고, AI의 선의에 의존하지 않는다.
2. **원본은 손실 없이, 읽기는 적게.** 원본은 계속 쌓이되 평소에는 읽지 않는다. AI가 매번 읽는 것은 정리된 노트와 INDEX뿐이다.
3. **사실은 지우지 않고 대체한다.** 언제 무엇을 믿었는지가 남아야 같은 실수를 다시 하지 않는다.
4. **평범한 파일과 git.** DB나 데몬이 없다. 노트는 Basic Memory 형식과 호환돼서, 필요할 때 검색 엔진을 파생 인덱스로 붙일 수 있다.
5. **두 호스트, 한 구현.** Claude Code와 Codex가 같은 플러그인, 같은 훅 스크립트, 같은 AGENTS.md를 쓴다.

## 3층 구조

| 층 | 위치 | 쓰는 주체 | 강제 수단 |
|---|---|---|---|
| 원본 | `journal/<날짜>/<host>-<session>.jsonl` | 훅 (UserPromptSubmit, PostToolUse(+Failure), Stop, Pre/PostCompact, SessionStart/End) | 자동 |
| 서술 | `journal/<날짜>/notes.md`, `attempts/` | 에이전트 | Stop 훅 `decision: block` |
| 정리 | `findings/`, `research/`, `entities/`, `INDEX.md` | 에이전트 (curate 스킬), `kn index` | UserPromptSubmit 알림, SessionStart 표시 |

### Stop 강제 규칙

- 마지막 노트 기록(`notes.md` 또는 curated 노트의 mtime) 이후 "실질 작업" 도구 사용이 `enforce.minEvents` 이상이면 block한다.
- 실질 작업에서 빼는 것:
  - 읽기 전용 도구 (Read, Grep, WebSearch 등)
  - 서브에이전트의 도구 사용
  - 노트 관리 명령 (`kn.cjs`, `.knowledge/` 경로)
- 루프 방지:
  - `stop_hook_active`면 통과한다.
  - 직전 block 이후 새 작업이 없으면 통과한다.
  - Claude는 연속 block 횟수에도 상한이 있다.
- `enforce.stop: remind`는 block 대신 다음 프롬프트에 알림을 주입하고, `off`는 강제를 끈다.

### 원본 기록 처리

- 비밀값 패턴은 마스킹한다 (API 키, 토큰, JWT, private key, `password=` 등).
- 긴 필드는 앞 60%와 뒤 30%만 남기고 잘린 위치를 표시한다.
- base64 이미지는 `assets/captured/<sha>.png`로 저장하고 경로로 치환한다 (LFS). Read 도구가 읽은 이미지는 원본 파일이 이미 있으므로 저장하지 않는다.
- 세션마다 파일을 따로 써서 동시 append 충돌을 줄인다.

## 노트 형식

- 공통 frontmatter: `id`(`att-`/`fnd-`/`res-`/`ent-` + 6hex), `title`, `type`, `permalink`(= `.knowledge` 기준 상대경로), `created`, `modified`, `tags`, `priority`, `when`.
- attempt: `outcome`(success|fail|partial|pending|abandoned), `derived_from`, `depends_on`, `sources`.
- finding (Graphiti 시간 모델):
  - `claim`, `about`, `status`(active|superseded|retracted|disputed)
  - `valid_from`, `valid_until`, `recorded`, `superseded_at`, `superseded_by`, `supersedes`
  - `sources`(필수), `confidence`
- 파일명은 ASCII kebab-case다. Basic Memory는 한글 permalink를 음역하므로, 한글은 title과 본문에만 쓴다.

## INDEX 라우팅

`kn index`가 노트 frontmatter에서 결정적으로 생성한다. 수동 메모 블록은 보존한다.

- 0 먼저 읽기 (`priority: critical|high`)
- 1 상황별 라우팅 (`when:`)
- 2 확정된 지식
- 3 진행 중인 시도
- 4 최근 시도
- 5 주제별 (tags)
- 6 허브 (역링크 수)
- 7 큰 문서 목차 (150줄 초과 문서의 `##` 앵커)
- 8 분쟁
- 9 원본 상태
- 10 이력

SessionStart에서는 0, 1, 3 섹션과 최근 서술 3개만 약 8,000자 예산 안에서 주입한다.

## 이중 호스트

조사 근거는 `docs/research/platform-specs.md`에 있다.

- Codex 0.159는 `.claude-plugin/marketplace.json`과 `plugin.json`, 그리고 `hooks/hooks.json`을 그대로 읽는다. 2026-10-21에 격리된 `CODEX_HOME`으로 설치하고 `codex exec`를 실행해서 실측했다.
- 훅 명령은 `node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT||process.env.PLUGIN_ROOT,'hooks','run.cjs'))" <event>` 형식이다. `$`, 역슬래시, 이중따옴표가 없어서 Git Bash(Claude)와 PowerShell(Codex, Windows)에서 똑같이 해석된다.
- 출력은 두 호스트 스키마의 교집합만 쓴다. 주입은 `hookSpecificOutput.additionalContext`이고, Stop은 `{decision, reason}`만 쓴다. Codex의 출력 스키마는 strict다.
- 호스트 판별:
  - 훅에서는 `PLUGIN_ROOT` 환경변수(Codex만 설정), 그다음 transcript 경로, 그다음 `turn_id`로 판별한다.
  - `kn note`에서는 `CODEX_THREAD_ID`, 그다음 `CLAUDECODE`로 판별한다.
  - Codex를 Claude 안에서 띄우면 `CLAUDECODE`가 상속되므로 Codex를 먼저 확인한다.

## 외부 도구에서 가져온 것과 버린 것

| 도구 | 가져온 것 | 버린 것 |
|---|---|---|
| claude-mem | 훅 IO 규율, truncation, 이미지 추출, redaction, 주입 예산 | 데몬, 도구마다 LLM 요약, SQLite/Chroma, Bun |
| Basic Memory | 노트 형식 호환, `bm_parse_semantics: false`, 섹션 단위 읽기 아이디어 | 코드 전부 (AGPL). 원하면 별도 MCP로 붙인다 |
| Beads | 해시 id, `derived_from`/`depends_on` 계보, 세션 종료 체크리스트 | Dolt, 이슈 트래커 전반 (선택 도구로 registry에 candidate) |
| Graphiti | 이중 시간 모델, 날짜 기반 결정적 대체, 모순 판정 가드레일 | 그래프 DB (도입 기준은 research 문서에 있음) |

## 남은 일

- 훅 해시가 바뀌었을 때 Codex `/hooks` 재승인이 필요한지 확인
- `.knowledge` 위에 Basic Memory MCP를 붙이는 trial
- code 프로필용 CODEMAP (harness-init에서 이전)
- 오래된 journal 압축이나 보관 정책
- Claude와 Codex 간 작업 인계 스킬 (handoff)
