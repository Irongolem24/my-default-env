# beads (bd) 조사

- 대상: `.vendor/beads` (MIT, Steve Yegge / gastownhall), 커밋 `8823177` (2026-10-20), plugin/npm 버전 1.3.0
- 결론 먼저: **(b) 경량 재구현을 기본으로, (a) bd는 "task-graph" 프로필용 선택적 연동** — 즉 both, 단 핵심 경로는 bd 비의존.

## 1. 개요

- "에이전트용 분산 그래프 이슈 트래커". markdown TODO/plan을 dependency graph로 대체하는 것이 목적.
- Go 단일 바이너리 `bd`. 저장소는 **Dolt**(버전관리되는 SQL DB). 과거의 SQLite + git-tracked JSONL 구조는 폐기됨.
- 핵심 루프: `bd create` → `bd dep add` → `bd ready`(블로커 없는 작업) → `bd update --claim` → `bd close --reason` → 블로커 해제 → 다시 ready.
- 부가: `bd remember/recall/forget/memories`(키-값 프로젝트 메모리), `bd prime`(세션 컨텍스트 주입), `bd compact`(닫힌 이슈 semantic 요약), molecules/gates/wisps(오케스트레이션용 고급 기능).
- 규모: `cmd/bd`만 수백 파일, `storage.go` 78K, `CHANGELOG.md` 730K. 무거운 엔터프라이즈급 코드베이스.

## 2. 데이터 모델

### 저장/동기화
- Embedded Dolt(기본, `.beads/embeddeddolt/`, single writer) 또는 Server 모드(`dolt sql-server`, `.beads/dolt/`). README "Storage Modes".
- 머신 간 동기화: `bd dolt push/pull` → git remote의 **`refs/dolt/data`** (코드 브랜치와 분리). `docs/architecture/dolt.md:427`.
- `.beads/issues.jsonl`은 **export(뷰어/교환용)일 뿐 source of truth 아님** (README). 즉 "JSONL in git + merge driver" 방식은 현행 아님.
- 머지: Dolt cell-level merge. 메모리(`kv.memory.*` config key)는 충돌 시 `--theirs` 자동 해결(`internal/storage/versioncontrolops/mergesettle.go:639-671`, `memoryops/doc.go`).
- 스키마 버전 가드: DB가 바이너리보다 앞서면 거부(`BD_IGNORE_SCHEMA_SKEW`로 우회). 업그레이드 시 "한 클론만 migrate" 절차 필요 → 운영 부담.

### Issue (`internal/types/types.go:20`)
- 핵심 필드: `id, title, description, design, acceptance_criteria, notes, status, priority(0-4), issue_type, assignee, owner, created_at/by, started_at, closed_at, close_reason, closed_by_session, labels, dependencies, comments, metadata(JSON), external_ref, defer_until, due_at`.
- status: `open | in_progress | blocked | deferred | closed | pinned | hooked` (`:578`).
- issue_type: `bug feature task epic chore decision message molecule gate spike story milestone event` (`:779`).
- 나머지(lease, wisp, molecule, gate, event_kind…)는 멀티에이전트 오케스트레이션용 — 우리에겐 과잉.

### ID (`internal/types/id_generator.go`)
- `prefix-` + sha256(title+description+created RFC3339Nano+workspaceID) hex 앞 6자, 충돌 시 7→8자로 점진 확장. 브랜치/에이전트 병렬 생성 시 충돌 없음.
- 계층 ID: `bd-a3f8.1.2` (`GenerateChildID`, 최대 3단계).

### Dependency (`types.go:1186`, `:1443-1473`)
- `{issue_id, depends_on_id, type, created_at, created_by, metadata(JSON), thread_id}`.
- 타입: `blocks, parent-child, conditional-blocks, waits-for, related, discovered-from, replies-to, relates-to, duplicates, supersedes, caused-by, validates, until, tracks, authored-by, …`.
- **ready에 영향 주는 것은 4개뿐**: `AffectsReadyWork() = blocks | parent-child | conditional-blocks | waits-for` (`types.go:1529`). 나머지는 지식 그래프용 non-blocking edge.
- ready 계산: SQL predicate(`internal/storage/issueops/ready_work.go`), `is_blocked`를 persisted projection으로 유지(`blocked_state.go`, `blocked_recomputer.go`). `defer_until` 미래면 ready에서 제외.

## 3. 메모리·저널 기능

### memoryops (`memoryops/`, `internal/memoryapi/memoryapi.go`, `cmd/bd/memory.go`)
- 단순 **key → string** 네임스페이스. config 테이블에 `kv.memory.<key>`로 저장. 페이징 없음(수십 개 규모 가정).
- 키 미지정 시 `DeriveKey`: lowercase → 비영숫자 run을 `-` 하나로 → 앞 8 segment → 60 byte cap. 같은 문장을 다시 remember하면 **upsert**(중복 방지). 이 slug 규칙은 "건드리면 전체 re-key"라 golden test로 고정.
- `bd prime`이 메모리를 세션 시작 시 주입. `--max-memories`, `--max-memory-chars` 캡 + "N개 생략, `bd memories`로 조회" 배너 (`cmd/bd/prime.go:133-142`). 훅 호스트가 조용히 truncate하는 문제 대응.
- 정책 문구: "프로젝트 사실은 bd remember, 개인 선호는 하네스 메모리" (`prime.go:1072`).

### journalops (`journalops/`)
- **clone-local, dolt_ignored** `bd_events_journal` 테이블: 모든 커밋된 mutation을 같은 트랜잭션에서 seq 순으로 기록. op, issue_id, actor, issue/dep/comment JSON snapshot.
- 용도: `bd events tail/export`, HTTP `/v0/beads/events` — 외부 consumer가 checkpoint부터 replay.
- 설계 포인트: seq가 순서, TS는 label(단조 아님). checkpoint가 보존 창 밖이면 빈 결과가 아니라 **`TruncatedError`**(silent data loss 방지) (`journalops/errors.go`).
- 즉 "발견/지식 기록"이 아니라 **기계용 감사 로그/CDC 피드**. 우리 raw journal과 개념은 같지만 목적이 다름.

### 발견/이력 기록
- `discovered-from` edge: 작업 중 파생된 이슈의 provenance (ready 영향 없음). 문서: `plugins/beads/skills/beads/resources/DEPENDENCIES.md:391` — research → finding → decision 체인 예시까지 있음.
- `close_reason`, `closed_by_session`, comments, `--append-notes`(notes 덮어쓰기는 `--force` 필요)로 이력 축적.
- `bd compact`: 30일 지난 closed 이슈를 semantic 요약(원문 폐기). `--analyze --json` → 에이전트가 요약 → `--apply` 모드는 API key 불필요 (`cmd/bd/compact.go:45-75`).

## 4. 에이전트 연동 방식

- Claude 플러그인 `plugins/beads/.claude-plugin/plugin.json`: 훅 `SessionStart`, `PreCompact` → `bd prime`. skills + commands 디렉터리.
- Codex 플러그인 `plugins/beads/.codex-plugin/hooks/hooks.json`: `SessionStart(startup|resume|clear)`, `PreCompact`, `PostCompact`, `UserPromptSubmit` → `bd codex-hook <event>`.
  - **패턴**: PostCompact에서 marker 파일만 쓰고, 다음 UserPromptSubmit에서 marker가 있으면 prime 재주입 후 marker 삭제 (`cmd/bd/codex_hook.go:77-124`). Codex의 compaction 후 컨텍스트 복구용.
- `bd prime` (`cmd/bd/prime.go`): MCP 모드(~50 tok)/CLI 모드(~1-2k tok) 분기, `🚨 SESSION CLOSE PROTOCOL 🚨` 체크리스트, "TodoWrite/markdown으로 task tracking 금지" 규칙, git authority profile(`conservative|minimal|team-maintainer`), `.beads/PRIME.md`로 오버라이드(로컬 → workspace → `%AppData%\beads\`), `prime.disabled`/`BD_PRIME_DISABLED`.
- ADR-0001 (`plugins/beads/skills/beads/adr/0001-bd-prime-as-source-of-truth.md`): CLI 레퍼런스는 SKILL.md에 복제하지 말고 런타임 생성 출력(`bd prime`)을 단일 출처로. SKILL.md는 ~500단어의 판단 기준만.
- SKILL.md의 결정 테스트: "2주 후에도 이 컨텍스트가 필요한가? YES=bd, NO=TodoWrite".
- `bd init`이 AGENTS.md 섹션 자동 삽입, `bd setup claude|codex|cursor|…`, `bd onboard`(수동 스니펫).

## 5. 설치 (Windows)

- `irm https://raw.githubusercontent.com/gastownhall/beads/main/install.ps1 | iex` — prebuilt zip + checksums 검증. Go 불필요.
- `winget install GasTownHall.Beads` (`PortableCommandAlias: bd` 필수, 이미 실행 중인 셸에도 보이게) — `winget/README.md`.
- `npm install -g @beads/bd` — postinstall이 네이티브 바이너리 다운로드. Windows에선 `bd.cmd` shim이라 Node `spawn`에 `shell: true` 필요.
- 릴리스 빌드: windows-amd64는 CGO=1(mingw, embedded Dolt 가능), **windows-arm64는 CGO=0 → server 모드 전용** (`.goreleaser.yml:80-116`).
- `go install` CGO=0이면 embedded 불가, 외부 `dolt sql-server` 필요. 방화벽 loopback 허용 필요.

## 6. 가져올 것 (MIT, 코드/문구 차용 가능)

1. **Ready 계산 규칙** — blocking edge 4종만 ready에 영향, 나머지는 provenance. 우리 `attempts/`에 적용:
   frontmatter `depends_on: [att-xxxx]`(blocking), `derived_from: att-yyyy`(=discovered-from, non-blocking), `supersedes:`, `parent:`. `INDEX.md` 생성 시 "열린 attempt 중 blocker가 모두 closed인 것"을 Ready 섹션으로 출력. 근거: `internal/types/types.go:1529`.
2. **Hash ID** — `att-` + sha256(goal+created+workspace)[:6], 충돌 시 확장. 병렬 세션/브랜치에서 파일명 충돌 없음. `GenerateHashID` 그대로 JS/Python 포팅 (`internal/types/id_generator.go`).
3. **계층 ID** `att-a3f8.1` — 한 실험의 하위 trial(파라미터 sweep 등). 최대 3단계 제한도 차용.
4. **Memory slug 규칙** — findings 파일명/키 자동 도출 + upsert. `DeriveKey`(8 segment, 60 byte) 포팅, golden test 동반 (`internal/memoryapi/memoryapi.go`).
5. **Prime 주입 설계** — SessionStart/PreCompact에서 `INDEX.md` 요약 + 최근 findings 주입. 캡(개수/문자) + 생략 배너 + "전체는 X에서 조회" (`cmd/bd/prime.go:133-142`). 템플릿 오버라이드 계층(project → user `%AppData%`), `*_DISABLED` env 킬스위치.
6. **Codex compaction 복구 패턴** — PostCompact marker → UserPromptSubmit에서 재주입 (`cmd/bd/codex_hook.go:106-124`). Claude/Codex 동일 훅 이벤트 지원 목표에 그대로 맞음.
7. **SESSION CLOSE PROTOCOL 체크리스트 문구** — "done이라 말하기 전에 반드시: attempt verdict 기록 / findings 승격 / INDEX 갱신". Stop 훅 강제와 병행 (`prime.go:1058-1076`).
8. **Journal 원칙** — seq 단조 번호 + TS는 label, checkpoint truncation은 명시적 에러. 우리 raw journal(JSONL)을 curated 단계가 checkpoint 기반으로 소비할 때 그대로 적용 (`journalops/journal.go`, `errors.go`).
9. **Agent-driven compaction** — `--analyze --json` → 에이전트가 요약 → `--apply` (API key 불필요). 오래된 attempts를 findings로 요약·아카이브하는 흐름에 차용.
10. **Close 필드** — `close_reason`, `closed_by_session`, `started_at` → attempt의 `verdict`, `cause`, `session_id`, 소요시간.
11. ADR-0001 원칙 — 스킬 문서에 레퍼런스 복제 금지, 런타임 생성 출력을 단일 출처로.

## 7. 버릴 것

- Dolt 저장소 전체(embedded/server, refs/dolt/data sync, 스키마 마이그레이션/skew guard) — Windows에서 CGO/방화벽/arm64 제약, 사람이 읽는 markdown 노트북과 정반대.
- lease/heartbeat/claim TTL, wisps, molecules, gates, formulas, swarm, messaging, federation, Jira/Linear/GitLab/ADO/Notion 연동, HTTP `bd serve`.
- 이슈 타입 13종, dependency 타입 15+종 → 우리는 `depends_on/derived_from/supersedes/parent` 4개면 충분.
- "markdown으로 tracking 금지" 규칙 — 우리 철학(markdown이 1차 산출물)과 상충.
- Automatic LLM compaction(API key 필요) 및 "원문 폐기" — 실험 노트는 원문 보존이 원칙. 요약은 추가, 삭제 아님.
- git authority profile 체계 — 우리 범위 밖(기록 시스템이지 커밋 정책 아님).

## 8. 권고: **both (b 중심)**

- **(b) 기본 경로**: attempts/findings/research markdown + frontmatter edge + 생성형 `INDEX.md`(Ready/Blocked/Superseded 섹션) + raw JSONL journal. 의존성은 Node 또는 PowerShell 스크립트 1개 수준. 모든 프로필(코드/이미지/자동화/창작)에 적용. 이유: 사람이 읽을 수 있고 git diff 가능, Windows에서 설치 0, bd의 핵심 가치(ready 계산, hash ID, provenance edge, prime 주입)는 수백 줄로 재현 가능.
- **(a) 선택 프로필 `task-graph`**: 장기·멀티에이전트 코딩 프로젝트에서 사용자가 이미 bd를 쓰면 연동. `bd` 존재 시(`where bd`)에만 SessionStart에서 `bd prime --memories-only` 또는 `bd ready --json` 결과를 함께 주입하고, attempt frontmatter에 `bd_issue: bd-xxxx` 링크 필드 허용. 설치 안내는 `winget install GasTownHall.Beads` / `install.ps1`. bd 미설치는 정상 상태로 취급(경고 없음).
- 하지 말 것: bd를 필수 의존성으로 두거나, attempts를 bd 이슈로 저장. Dolt DB는 사람이 읽는 lab notebook 요구와 맞지 않고 Windows/Go 미설치 환경에서 실패 지점이 늘어남.

## 9. 출처 (모두 `.vendor/beads/` 기준)

- `README.md` (Storage Modes, Essential Commands)
- `internal/types/types.go` (Issue `:20`, Status `:578`, IssueType `:779`, Dependency `:1186`, DependencyType `:1443`, `AffectsReadyWork` `:1529`)
- `internal/types/id_generator.go`
- `internal/storage/issueops/ready_work.go`, `blocked_state.go`
- `memoryops/doc.go`, `memoryops/memories.go`, `internal/memoryapi/memoryapi.go`
- `journalops/doc.go`, `journalops/journal.go`, `journalops/errors.go`
- `cmd/bd/prime.go`, `cmd/bd/codex_hook.go`, `cmd/bd/compact.go`
- `plugins/beads/.claude-plugin/plugin.json`, `plugins/beads/.codex-plugin/hooks/hooks.json`, `plugins/beads/skills/beads/SKILL.md`, `plugins/beads/skills/beads/adr/0001-bd-prime-as-source-of-truth.md`, `plugins/beads/skills/beads/resources/DEPENDENCIES.md`
- `docs/getting-started/installation.md` (Windows 11), `docs/architecture/dolt.md`, `winget/README.md`, `npm-package/package.json`, `.goreleaser.yml`
