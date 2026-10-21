# Basic Memory 조사 보고서

- 대상: `.vendor/basic-memory` (v0.23.2, commit `976a10c`, 2026-10-20)
- 라이선스: 루트 `LICENSE` = **AGPL-3.0-or-later** (`pyproject.toml:7`). `skills/README.md`와 `plugins/claude-code/README.md`는 각자 "MIT"라고 적고 있고, `plugins/codex/.codex-plugin/plugin.json`에는 `"license": "MIT"`가 있다. 그런데 하위 디렉터리에 LICENSE 파일은 없다. → **어느 쪽이든 코드와 문장은 복사하지 않는다.** 아이디어와 포맷 호환만 가져간다.

## 1. 개요

- 로컬 우선(local-first) 지식 그래프다. **Markdown 파일이 원본(source of truth)**이고 SQLite DB(FTS5 + sqlite-vec)는 파일에서 다시 만들 수 있는 projection이다.
- 진입점은 MCP 서버(`basic-memory mcp`), CLI(`bm` / `basic-memory`), FastAPI 세 가지다. Python ≥3.12.
- 노트 하나 = entity. entity는 observations(분류된 사실)와 relations(`[[wikilink]]` 엣지)를 가진다.
- 파일 watcher가 바뀐 파일을 1초 debounce(`index_delay=1000`)로 재인덱싱한다. **사람이나 다른 도구가 파일을 직접 고쳐도 인덱스에 반영된다.** 우리 구조(hooks/AI가 파일을 직접 씀)와 맞는 핵심 전제다.
- Claude Code 플러그인(`plugins/claude-code`)과 Codex 플러그인(`plugins/codex`)은 SessionStart(브리핑)와 PreCompact(체크포인트) 훅, 스킬, output-style로 구성된다.

## 2. 노트 포맷 스펙 요약 (호환하려면 반드시 지킬 것)

근거 자료: `docs/NOTE-FORMAT.md`(루트 `NOTE-FORMAT.md`보다 최신이며 `created`/`modified`, 따옴표 relation이 추가됨), `src/basic_memory/markdown/plugins.py`, `entity_parser.py`, `utils.py`.

### 2.1 Frontmatter

```yaml
---
title: Attempt 2026-10-21 lora-rank-sweep     # 없으면 파일명 stem. [[링크]] 해석 키
type: attempt                                 # 기본값 note. schema 해석과 필터링에 쓰임 (소문자 권장)
tags: [lora, sdxl]                            # list 또는 "a, b" 문자열
permalink: attempts/2026-10-21-lora-rank-sweep  # 안정 ID. 직접 지정 권장 (아래 주의 참고)
created: 2026-10-21T14:03:00+09:00            # ISO 8601. 없으면 file ctime
modified: 2026-10-21T15:10:00+09:00           # 없으면 file mtime
status: failed                                # 임의 커스텀 키 → entity_metadata. metadata_filters로 검색 가능
---
```

- 표준 키는 `title`, `type`, `tags`, `permalink`, `created`, `modified`, `schema`다. **나머지 키는 전부 `entity_metadata`로 인덱싱되고** `search_notes(metadata_filters={"type":"attempt","status":"failed"})`로 조회된다.
- 숫자와 bool은 문자열로 정규화된다(`true` → `"True"`). 날짜 문자열은 ISO 문자열로 유지된다.
- `created`/`modified`가 잘못된 값이면 해당 필드는 인덱싱 오류가 된다(파일 시각으로 조용히 대체되지 않음).
- **`bm_parse_semantics: false`**를 넣으면 해당 노트는 "graph-silent"가 된다. 검색과 섹션 인덱싱은 되지만 observation과 relation은 추출하지 않는다(`entity_parser.py:375`). → **raw journal 파일에 붙이기 적합하다.**

### 2.2 Observation

```
- [category] content #tag1 #tag2 (context)
- [decision] @effective:2026-10-21 rank 16 채택 (sweep 결과)
```

- 정규식은 `^\[([^\[\]()]+)\]\s+(.+)`이다. category 안에 `[]()`는 쓸 수 없다.
- **(context)는 줄 맨 끝의 괄호 하나만** 인식한다(`rfind("(")`).
- tag는 공백으로 나뉜 토큰 중 `#`로 시작하는 것이다. content 원문에는 tag 텍스트가 그대로 남는다.
- 제외되는 패턴: `- [ ]`, `- [x]`, `- [-]` 체크박스, `[/]`, `[>]`, `[?]` 같은 1글자 비영숫자 마커, `[00:01:02]` 같은 타임코드, `- [text](url)`, `- [[X]]`, blockquote(`> [!info]` 콜아웃) 내부.
- 시간 한정자(temporal qualifier) `@effective|occurred|due|mentioned|valid:DATE`와 범위 `@effective[2026-06-10,2026-10-14)`는 `search_notes(valid_at=..., time_kind=...)`로 질의된다.
- ⚠ **함정**: 파서는 리스트 항목만이 아니라 **모든 inline 토큰**(문단, 헤딩 포함)에서 `[cat] ...` 시작이나 `#word` 토큰을 observation으로 잡는다(`plugins.py` `observation_rule`, `entity_parser.parse`). 예를 들어 본문 문장 "Fixed #42"는 category `Note`, tag `42`인 observation이 된다. → 본문 prose와 헤딩에서 `#번호`/`#단어`를 피하고, 이슈 번호는 `PR 42`나 인라인 코드 `` `#42` ``로 쓴다(코드 블록과 인라인 코드 안은 안전하다).

### 2.3 Relation

```
- relation_type [[Target]] (context)        # 따옴표 없는 단일 토큰
- "multi word type" [[Target]] (context)   # 여러 단어는 반드시 따옴표
- [[Target]]                                # → links_to
- 산문 문장 [[Target]]                        # → links_to (공백 있는 접두어 = 산문)
- Mother [[Alice]] #bm:links_to             # 단일 토큰 접두어를 산문으로 강제
본문 문장 속 [[A]], [[B]]                       # 각각 links_to
[텍스트](../findings/x.md#anchor)             # 같은 프로젝트 파일 경로 → links_to (fragment 무시)
```

- explicit relation이 되려면 **리스트 항목** 안에 있어야 하고, `]]` 뒤에는 **아무것도 없거나 균형 잡힌 괄호 하나**만 와야 한다. 다른 문구가 붙으면(prose tail) inline `links_to`로 떨어진다.
- `[[Target|alias]]`를 지원한다(`normalize_link_text`). `[[project::note]]`는 다른 프로젝트 참조다. `[[../path/file.md]]`는 상대 경로로 정확한 파일 하나만 가리킨다.
- `[[Target]]` 해석 순서(`link_resolver.py:95`): ① permalink 정확 일치 ② title 정확 일치 ③ file path ④ path + `.md` ⑤ 대소문자/`_`/`-` 무시 path alias ⑥ FTS fuzzy. 대상이 없으면 forward reference로 남았다가 대상이 생기면 해결된다.
- `[[Target#heading]]`의 헤딩 앵커를 해석하는 로직은 찾지 못했다. 위키링크 앵커는 **링크 대상 해석에 쓰이지 않는다**고 가정한다. 섹션 단위 접근은 `read_note` 섹션/라인 범위로 한다(4절).

### 2.4 Permalink

- frontmatter에 `permalink`가 있고 그 값이 고유하면 **그대로 쓰고, 파일을 다시 쓰지 않는다**(`note_preparation.py:252`).
- 없으면 **파일 경로**로 만든다(문서에는 "title에서"라고 되어 있지만 코드는 path 기반 `build_canonical_permalink`다). 기본값 `permalinks_include_project=True`라서 **프로젝트 slug가 앞에 붙고**, 이 값이 frontmatter에 **기록된다**.
- slug 규칙(`utils.generate_permalink`): NFC 정규화 → 확장자 제거 → camelCase 분리 → 소문자 → `_`·공백을 `-`로 → `[^a-z0-9/.-]`를 `-`로 → 연속 `-` 축약.
- ⚠ **한글은 CJK 보존 범위(\u4e00–\u9fff 등)에 들어 있지 않아서 `unidecode`로 음역된다**(예: "실험" → `silheom`). → **파일명과 permalink는 ASCII kebab-case로 하고, 한글은 title에만 둔다.**
- 중복이 나면 `-1`, `-2` suffix가 붙는다. `update_permalinks_on_move=False`(기본값)이라 파일을 옮겨도 permalink는 유지된다.
- `memory://<permalink>` URL을 쓰고 `memory://attempts/*` 와일드카드를 지원한다.

### 2.5 BM이 우리 파일에 쓰는 것(write-back) — 호환의 핵심

`indexing/batch_indexer.py:450`:
- frontmatter가 **없으면** `permalink`를 써 넣는다(+ `ensure_frontmatter_on_sync=True`이면 `title`, `type`도).
- frontmatter가 **있어도 permalink가 없거나 다르면** `permalink` 한 줄을 써 넣는다.
- 형식이 깨진(malformed) frontmatter는 건드리지 않는다.
- → **우리 writer가 항상 `title`/`type`/`permalink`를 직접 쓰고 permalink를 전역에서 고유하게 유지하면 BM이 파일을 건드릴 일이 없다.** permalink에는 프로젝트 접두어 없이 `.knowledge/` 기준 상대 경로를 쓴다(예: `attempts/2026-10-21-lora-rank-sweep`).

### 2.6 Schema (선택 사항, Picoschema)

- `type: schema`, `entity: Attempt`, `schema: {field: type, field?: type, f?(array): T, f?(enum): [...]}`, `settings: {validation: warn|strict}` 형식의 노트(관례상 `schema/` 폴더).
- 필드는 observation `[field]` 또는 relation `field [[X]]`에 매핑된다. 대문자 타입은 entity 참조다.
- 플러그인 schema는 `settings.frontmatter:`로 frontmatter 필드(예: `status?(enum)`)도 선언한다(`plugins/claude-code/schemas/decision.md`).
- 연결 우선순위: inline dict → 문자열 참조 → `type`과 같은 이름의 schema. `bm schema validate|infer|diff` 명령이 있다.

## 3. 그래프·검색 구조

- **파싱**: markdown-it + 자체 core rule 2개(observation, relation). 섹션은 별도로 구조 스캔한다(`markdown/sections.py`). 헤딩 경계, body 기준 줄 번호와 byte offset을 저장하고, 시맨틱 opt-out 노트에서도 동작한다.
- **저장**: SQLite. entity / observation / relation 테이블과 FTS5 가상 테이블 `search_index`(`models/search.py:137`)가 있다.
  - FTS 컬럼은 `title`, `content_stems`, `content_snippet`, `script_ngrams`, `permalink`다. 토크나이저는 `unicode61 tokenchars '/'`, `prefix='1,2,3,4'`다.
  - entity, observation, relation이 **각각 검색 row**다(`type` 컬럼). 그래서 "decision 카테고리 observation만" 검색할 수 있다(`entity_types=["observation"], categories=["decision"]`).
  - **한글**: 한글 음절/자모는 `script_ngrams` bigram으로 색인된다(`repository/script_ngrams.py`). 띄어쓰기 없는 부분 검색도 된다.
- **시맨틱**: fastembed(기본 `BAAI/bge-small-en-v1.5`, 384차원) + sqlite-vec. hybrid 점수는 `max + 0.3*min`이다. 다국어에는 `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`를 쓰라고 공식 권장한다(KO 포함 벤치마크: `docs/multilingual-embedding-benchmark.md`). 모델을 바꾸면 `bm reindex --embeddings`를 실행해야 한다.
- **search_type**: `text | semantic(vector) | hybrid | title | permalink(와일드카드)`. Boolean 연산자를 자동 감지한다. `metadata_filters`, `after_date`, `valid_at`, `compact=True`(본문 생략)를 지원한다.
- **그래프 탐색**: `build_context(url="memory://x", depth=1, timeframe=..., max_related=...)`로 relation을 따라 이웃을 모은다. `recent_activity(timeframe="3d")`도 있다.
- **큰 노트**:
  - `read_note(start_line, end_line)`: 라인 범위를 읽는다. 결과에 `has_more`와 `next_start_line`이 붙는다.
  - API `section=` 셀렉터: `"Decisions"`, 경로형 `"Auth/Decisions"`, 중복 헤딩용 `"Heading[1]"`, `"## Auth"` 접두어 허용.
  - `max_tokens` 예산: **섹션 경계 → 빈 줄(문단) 경계 → 줄 경계** 순서로 자르고 continue 줄을 단다(`sections.py:_token_budget_line_count`).
  - 편집: `edit_note`의 `replace_section`, `insert_after_section`, `find_replace`, `append`/`prepend`와 낙관적 잠금 `expected_checksum`.
  - 권장 루틴은 compact 검색 → 필요한 라인 범위만 읽기(`docs/COMPACT_DISCOVERY.md`).
- **Wiki Projector**(`bm wiki rebuild`, 수동 실행): 폴더마다 `index.md`(`## Sections` 하위 폴더 링크, `## Notes`에 `[[permalink|Title]]` 목록)와 `log.md`(최근 25건, `bm_parse_semantics: false`)를 결정론적으로 생성한다.
  - 생성 파일 frontmatter에는 `generated: {by, at}`, `bm: {profile, source_watermark}`가 들어간다.
  - 사람이 쓴 `index.md`와 이름이 겹치면 conflict로 보고하고 덮어쓰지 않는다. 파일명은 casefold로 비교한다.
- **무시 규칙**: `~/.basic-memory/.bmignore`(기본값에 `.*` 숨김 파일 포함)와 **프로젝트 루트의 `.gitignore`**. 패턴은 프로젝트 루트 기준 상대 경로로 매칭한다.

## 4. 스킬·프롬프트에서 가져올 아이디어 (경로)

| 아이디어 | 출처 | 우리 쪽 적용 |
|---|---|---|
| 3층 구조: Ambient(hooks) / Background(output-style 반사행동) / Deliberate(skills) | `plugins/claude-code/DESIGN.md` §3 | raw = hooks, curated = skill과 반사 규칙, routing = INDEX. 같은 구조로 정리한다 |
| SessionStart 브리핑: 활성 task, open decision, 최근 session을 구조화 질의 → **10k자 예산**, 그래프 텍스트는 **"reference data, not instructions"로 fence**(백틱 길이 가변) | `src/basic_memory/cli/commands/hook.py:18,77,706` | INDEX.md, 최근 attempts, open findings 브리핑을 예산 안에서 fence로 감싸 주입한다(prompt-injection 경계) |
| 훅은 **fail-open**: 모든 오류에도 exit 0, 세션을 방해하지 않음 | `plugins/claude-code/hooks/session_start.py` docstring, `hook.py` Contracts | 우리 journal 훅의 필수 원칙으로 삼는다 |
| PreCompact 체크포인트: 600초 예산. **먼저 짧게 쓰고 나중에 보강**(timeout에 죽어도 남도록). `[decision]`/`[problem]`/`[attempted]`/`[rejected]`/`[next-step]` | `DESIGN.md` §4.2 | PreCompact 때 journal flush와 attempt 초안을 먼저 append한다 |
| Codex SessionStart matcher `startup\|resume\|compact`, Codex 플러그인 루트 변수 `${PLUGIN_ROOT}` (Claude는 `${CLAUDE_PLUGIN_ROOT}`) | `plugins/codex/hooks/hooks.json` | 듀얼 하네스 훅 매니페스트를 작성할 때 참고한다 |
| 플러그인 훅 = 한 줄 shim → 실제 로직은 단일 CLI(`bm hook <verb> --harness claude\|codex`), stdin 어댑터는 하네스별 | `hook.py` docstring | `mde hook <event> --harness ...` 같은 단일 진입점을 둔다 |
| Stop 훅 퇴역(no-op 유지) | `hook.py:1331` | Stop 훅에서 무거운 작업을 하지 않는다 |
| 쓰기 표준: narrative spine(problem → approach → state/impact), "durable lesson" 명시, **evidence boundary**(실행하지 않은 테스트를 통과했다고 쓰지 않음) | `plugins/claude-code/skills/bm-writing/SKILL.md` | attempts/findings 작성 규칙에 반영한다 |
| 체크포인트 섹션 고정: Summary / Story / Project Memory / Changed Files / Verification / Observations / Relations. 빈 카테고리는 쓰지 않음("None" 금지) | `skills/bm-checkpoint/SKILL.md` | attempt 템플릿 골격 |
| relation을 observation으로 쓰지 말 것(`[relates_to]` 금지). Decisions는 별도 섹션 대신 `[decision]` observation으로 | `bm-writing`, `bm-checkpoint` | 린트 규칙 |
| Typed note + 구조화 recall: `type: decision, status: open`, `type: task, status: active` → `metadata_filters` | `output-styles/basic-memory.md`, `schemas/*.md` | `type: attempt\|finding\|research`, `status`, `outcome` frontmatter |
| queryable 필드는 frontmatter에 두고 observation `[status] active`로도 미러링(schema_validate용) | `plugins/claude-code/schemas/task.md` | 선택 사항 |
| 쓰기 전에 검색: 이름 변형 여러 개로 검색해 중복을 막고, 있으면 `edit_note`로 갱신 | `skills/memory-notes/SKILL.md` "Before Creating a Note" | curated writer의 첫 단계 |
| 시간 한정자: 사실이 바뀌면 지우지 말고 범위를 닫음 `@effective[a,b)` | `memory-notes`, `memory-defrag` | findings가 뒤집힐 때 쓴다 |
| **Reflect**(sleep-time): 마지막 reflection 이후 변경분 → 남길 것(결정·교훈·선호·소유·약속)과 버릴 것(루틴)을 판정 → durable note에 합침 | `skills/memory-reflect/SKILL.md` | **journal → attempts/findings 증류 루프의 원형** |
| **Defrag**: 몇백 줄 넘는 노트는 split. 계획 노트(`type: defrag-plan`, `[split]`/`[consolidate]`/`[contradiction]`/`[retire]`)를 먼저 쓰고, 손실 없는 것만 자동 적용. "Never delete raw notes", "Recency is not truth" | `skills/memory-defrag/SKILL.md` | 큰 문서 관리와 INDEX 정비 정책 |
| **Curate**: orphan 탐지, typed relation 제안, hub/index note(`type: index`, `## Decisions`/`## Patterns`에 링크 나열) | `skills/memory-curate/SKILL.md` §6 | INDEX.md 및 주제별 hub |
| Wiki Projector: 결정론적 폴더별 `index.md`와 `log.md`. 생성물 표식은 `generated.by`, 로그는 graph-silent | `src/basic_memory/indexing/wiki_projector.py:598-770` | 생성 INDEX와 사람이 쓴 섹션을 마커로 구분, 로그는 `bm_parse_semantics: false` |
| Session identity = (agent, session_id) 쌍. 추측하지 말 것 | `bm-checkpoint` | journal 레코드 키 |
| Lifecycle: status 폴더와 archive 이동 | `skills/memory-lifecycle/SKILL.md` | attempts 보관 정책(선택) |

## 5. 우리 폴더를 BM으로 인덱싱하는 방법

전제: 프로젝트 루트는 **`.knowledge/` 자체**로 잡는다. 저장소 루트를 잡으면 기본 `.bmignore` 패턴 `.*`에 걸려 `.knowledge`가 통째로 무시된다.

### 5.1 설치와 등록 (Windows PowerShell)

```powershell
# uv 필요. --prerelease=allow 필수 (FastMCP pre-release 의존; 없으면 구버전이 설치됨)
uv tool install basic-memory --prerelease=allow      # 또는 uvx로 매번 실행

# 프로젝트 등록 (등록하면서 즉시 인덱싱함. 크면 --no-wait)
basic-memory project add myproj-knowledge "C:\work\myproj\.knowledge"
# 기본 프로젝트로 지정하려면
basic-memory project default myproj-knowledge

# 재인덱스
basic-memory reindex            # --search(FTS만) / --embeddings(벡터) / --full
basic-memory status --project myproj-knowledge
```

설정 파일은 `%USERPROFILE%\.basic-memory\config.json`이다(`BASIC_MEMORY_CONFIG_DIR`로 변경 가능). 형태는 다음과 같다.

```json
{
  "projects": { "myproj-knowledge": { "path": "C:\\work\\myproj\\.knowledge", "mode": "local" } },
  "default_project": "myproj-knowledge",
  "permalinks_include_project": false,
  "ensure_frontmatter_on_sync": true,
  "update_permalinks_on_move": false
}
```

모든 필드는 환경 변수 `BASIC_MEMORY_<FIELD>`로도 덮어쓸 수 있다(env_prefix `BASIC_MEMORY_`). 예: `BASIC_MEMORY_HOME`(기본 main 프로젝트 경로).

### 5.2 MCP 연결

```powershell
# Claude Code (프로젝트 하나로 제한)
claude mcp add basic-memory -- uvx --prerelease=allow basic-memory mcp --project myproj-knowledge
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.basic-memory]
command = "uvx"
args = ["--prerelease=allow", "basic-memory", "mcp", "--project", "myproj-knowledge"]
```

`--project`는 서버를 단일 프로젝트로 제한한다(`BASIC_MEMORY_MCP_PROJECT`). MCP 서버 lifespan이 watcher와 인덱싱을 함께 돌리므로 별도 sync 프로세스는 필요 없다.

### 5.3 한국어 시맨틱 검색 (선택)

```powershell
basic-memory config set semantic_embedding_model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
basic-memory config set semantic_embedding_dimensions 384
basic-memory reindex --embeddings
```

### 5.4 우리 쪽 준수 사항 (BM이 파일을 건드리지 않게)

1. 모든 curated 노트에 `title`, `type`, `permalink`(프로젝트 접두어 없는 상대 경로 slug, 전역에서 고유)를 직접 쓴다. 이렇게 하면 write-back이 0이 된다.
2. 파일명은 ASCII kebab-case다. 한글은 title과 본문에만 쓴다.
3. `journal/` raw 파일은 `.md`로 둘 경우 frontmatter에 `bm_parse_semantics: false`와 permalink를 넣는다. 검색은 되지만 그래프는 오염되지 않는다. `.jsonl`이면 BM이 markdown으로 파싱하지 않는다. 아예 빼려면 `.knowledge/.gitignore`에 `journal/`을 넣는다(git 추적에도 영향이 가므로 주의).
4. **`INDEX.md`가 있는 상태에서 `bm wiki rebuild`를 실행하지 말 것.** `index.md`/`log.md`는 casefold로 비교하는 예약 파일명이라 conflict가 난다. 쓰고 싶다면 우리 INDEX를 다른 이름으로 바꾼다.
5. 본문 prose와 헤딩에 `#단어` 토큰을 쓰지 않는다(observation 오검출, 2.2 참고).

## 6. 버릴 것

- 코드 전체(AGPL): 파서, 인덱서, FTS/벡터 스택, CLI. 우리는 파일 포맷만 맞춘다.
- Cloud, workspace, team 프로젝트, rclone bisync, Postgres/Milvus, OAuth, 자동 업데이트.
- MCP `write_note` 중심 쓰기 경로. BM은 "AI가 MCP로 쓴다"를 전제하지만, 우리는 **hooks와 AI가 파일을 직접 쓰고 BM은 선택적 읽기·검색 뷰**로만 둔다.
- `settings.json`의 `basicMemory` 블록, `primaryProject`/`secondaryProjects` 같은 설정 체계.
- `uv run --script` 기반 훅 런처. Windows에서 uv 의존이 추가되고 첫 실행 지연이 생긴다. 우리 훅은 의존성 0인 Node나 PowerShell로 간다.
- Picoschema 검증 강제(우리는 warn 수준의 자체 린트로 충분하다).
- Wiki Projector를 그대로 쓰는 것(INDEX 이름 충돌). 아이디어만 가져간다.

## 7. 시사점

1. **포맷은 거의 공짜로 호환된다.** frontmatter(`title`/`type`/`tags`/`permalink`/`created`/`modified` + 커스텀 키), `- [cat] text #tag (ctx)`, `- rel_type [[T]] (ctx)`만 지키면 BM이 우리 `.knowledge/`를 그대로 그래프로 만든다. 커스텀 키(`status`, `outcome`, `priority`, `situation`)는 자동으로 metadata 필터가 된다. INDEX의 "우선순위/상황별 라우팅"을 BM 쪽 질의로도 재현할 수 있다.
2. **permalink는 우리가 소유한다.** 직접 쓰지 않으면 BM이 프로젝트 접두어를 붙여 파일에 써 넣는다. writer와 린터에서 "permalink 필수, 고유, ASCII"를 강제한다.
3. **raw와 curated 분리는 `bm_parse_semantics: false`로 BM 개념에 그대로 대응된다.** journal = graph-silent 원본, attempts/findings = 시맨틱 노트.
4. **큰 문서 정책**: BM은 "헤딩 = 섹션 주소"(경로형 `A/B`, 중복은 `[n]`)와 "섹션 → 문단 → 줄" 순서의 예산 절단을 쓴다. 우리 TOC/anchor 설계도 **고유하고 안정적인 헤딩**을 1급 주소로 삼고, 수백 줄을 넘으면 split(defrag 규칙)한다.
5. **증류 루프 설계 근거**: reflect(주기적으로 변경분 → durable note), defrag(계획 노트 → 손실 없는 변경만 자동 적용), curate(orphan/hub). 이 3종을 우리 curated layer의 스킬 3종으로 재구성할 수 있다(문장은 새로 쓴다).
6. **훅 계약**: fail-open, 브리핑 10k자 예산, 그래프 텍스트 fence(prompt-injection 경계), PreCompact에서는 먼저 쓰고 나중에 보강. 우리 "강제 기록" 훅에 그대로 적용한다.
7. **한국어**: FTS는 bigram 덕분에 한글을 지원하지만 permalink는 음역되고, 기본 임베딩은 영어 전용이다. 문서화할 때 "BM 연동 시 multilingual 모델 권장"을 안내한다.

## 8. 출처 (모두 `.vendor/basic-memory/` 기준)

- `docs/NOTE-FORMAT.md`, `NOTE-FORMAT.md`(구버전), `docs/MARKDOWN_RELATIONS.md`, `docs/COMPACT_DISCOVERY.md`, `docs/semantic-search.md`, `docs/multilingual-embedding-benchmark.md`, `docs/DOMAIN_MODEL.md`, `docs/ARCHITECTURE.md`
- `src/basic_memory/markdown/plugins.py` (observation/relation 파서), `markdown/entity_parser.py` (frontmatter, `bm_parse_semantics`, sections), `markdown/sections.py` (섹션 셀렉터, 예산 절단)
- `src/basic_memory/utils.py` (`generate_permalink`), `services/note_preparation.py:225` (`resolve_permalink`), `services/link_resolver.py` (해석 순서, alias), `indexing/batch_indexer.py:435-500` (write-back)
- `src/basic_memory/models/search.py:137` (FTS5 스키마), `repository/script_ngrams.py`, `config_models.py` (설정 필드, data dir), `ignore_utils.py`
- `src/basic_memory/indexing/wiki_projector.py`, `index/local_wiki_projection.py`, `cli/commands/wiki.py`
- `src/basic_memory/cli/commands/mcp.py`, `project.py:844`, `db.py:330`, `hook.py`
- `src/basic_memory/mcp/tools/read_note.py`, `edit_note.py`, `build_context.py`, `search.py`
- `plugins/claude-code/{DESIGN.md, hooks/hooks.json, hooks/session_start.py, output-styles/basic-memory.md, schemas/*.md, skills/bm-*/SKILL.md, settings.example.json}`
- `plugins/codex/{.codex-plugin/plugin.json, .mcp.json, hooks/hooks.json}`
- `skills/{memory-notes, memory-reflect, memory-defrag, memory-curate, memory-capture, memory-lifecycle}/SKILL.md`
- `README.md` (Claude Code/Codex MCP 설정), `llms-install.md`, `pyproject.toml`
