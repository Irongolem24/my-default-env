# Graphiti 연구 노트 — 마크다운 지식 기록에 이식할 아이디어

> 대상: `.vendor/graphiti` (getzep/graphiti, Apache-2.0, commit `9663da6`, 2026-10-20). Neo4j/FalkorDB는 돌리지 않는다. **아이디어만** 가져간다.

## 1. 개요

- Graphiti = AI agent용 **temporally-aware knowledge graph**. 입력 단위는 *episode*(원문 조각)이다. LLM이 여기서 *entity node*와 *fact edge*를 추출하고, 기존 그래프에 대해 dedup → contradiction 판정 → 시간 기반 무효화를 거친다.
- 핵심 가치: **사실을 지우지 않고 만료시킨다**. 히스토리를 보존하면서 "지금 유효한 것"도 질의할 수 있다.
- 우리 시스템과의 대응: `journal`(raw, append-only) = episode / `findings/`·`research/` 노트 = fact(edge) / 노트가 다루는 대상(모듈·라이브러리·버그) = entity / `INDEX.md` = community summary에 가까운 라우팅 계층.

## 2. 핵심 개념

| Graphiti | 의미 | 코드 |
|---|---|---|
| `EpisodicNode` | 원본 데이터. `content`, `source`(text/message/json), `valid_at`(=원문 생성 시각), `entity_edges`(이 에피소드가 만든 fact 목록) | `graphiti_core/nodes.py:318` |
| `EntityNode` | 실세계 대상. `name`, `summary`(주변 edge 요약), `attributes` | `nodes.py:499` |
| `EntityEdge` | **fact**. `fact`(자연어 문장), `episodes`(provenance: 근거 에피소드 uuid 목록), `valid_at`/`invalid_at`, `created_at`/`expired_at`, `reference_time` | `graphiti_core/edges.py:263` |
| `group_id` | 지식 도메인 파티션 | 전역 |
| saga | 순서 있는 에피소드 묶음 + running summary | `prompts/summarize_sagas.py` |

**Bi-temporal 4필드** (가장 중요):
- `valid_at` — 사실이 *현실에서* 참이 된 시각 (event time).
- `invalid_at` — 사실이 *현실에서* 더 이상 참이 아니게 된 시각.
- `created_at` — 시스템이 이 사실을 *기록한* 시각 (transaction time).
- `expired_at` — 시스템이 이 사실을 *무효 처리한* 시각. `expired_at != null`이면 "현재 믿지 않음".

"언제 사실이었나"와 "언제 우리가 그렇게 믿었나"를 분리한다. Entity/episode 구분의 원칙은 **원문(episode)은 불변, 해석(entity/edge)은 갱신 가능**이다. Edge는 항상 `episodes[]`로 근거를 역추적할 수 있다.

## 3. 무효화·시간 모델 동작 (code paths)

경로: `Graphiti.add_episode` → `extract_edges` → `resolve_extracted_edges` (`utils/maintenance/edge_operations.py:424`).

1. **추출** (`prompts/extract_edges.py`): LLM이 fact마다 `valid_at`/`invalid_at`를 채운다. 규칙: 현재형이면 `valid_at = 에피소드 시각`. 미래 계획/약속이면 `valid_at = 진술 시각`(미래 날짜 아님). soft deadline("by Q3")은 `invalid_at`가 아니다. 명시적 종료/변경이 있을 때만 `invalid_at`를 쓰고, 근거가 없으면 둘 다 null.
2. **후처리 정규화** (`utils/maintenance/temporal_edge_utils.py`): 정규식(`will|plans to|scheduled to|...`)으로 미래형을 감지해 `valid_at`을 reference_time으로 클램프하고 deadline류 `invalid_at`를 제거한다. LLM 출력을 규칙으로 한 번 더 교정하는 패턴이다.
3. **후보 수집** (`edge_operations.py:~525-585`): hybrid search(BM25+vector, RRF)를 두 갈래로 돌린다.
   - `related_edges` = **같은 endpoint 쌍**(양방향)의 edge → duplicate 후보.
   - `existing_edges` = 그래프 전체에서 의미가 가까운 edge(related 제외) → **invalidation 후보**.
4. **Fast path**: endpoint가 같고 정규화한 fact 문자열이 일치하면 LLM 없이 기존 edge를 재사용하고 `episodes`에 provenance만 추가한다 (`_dedupe_extracted_edge`).
5. **LLM 판정** (`prompts/dedupe_edges.py: resolve_edge`): 두 리스트를 **연속 idx**로 보여주고 `{duplicate_facts, contradicted_facts}`를 받는다. duplicate은 related에서만, contradiction은 양쪽 모두에서 고를 수 있다. 범위 밖 idx는 코드가 검증해 버린다.
   - duplicate이면 새 edge를 버리고 기존 edge에 에피소드 provenance를 append한다.
6. **시간 기반 무효화** (`_apply_temporal_invalidation`, `resolve_edge_contradictions`, `edge_operations.py:715-785`):
   - 새 fact가 이미 `invalid_at`을 갖고 들어왔다면 처음부터 historical이다: `expired_at=now`.
   - 모순 후보 중 **새 fact보다 나중에 시작된** 것이 있으면 새 fact 쪽이 낡은 것이다. 새 fact의 `invalid_at = 후보.valid_at`, `expired_at=now` (늦게 도착한 옛 정보 처리).
   - 시간 구간이 겹치지 않으면(old.invalid_at ≤ new.valid_at 또는 그 반대) 둘 다 유지한다. 모순이 아니다.
   - old.valid_at < new.valid_at이면 **old.invalid_at = new.valid_at, old.expired_at = now**. 삭제는 하지 않는다.
   - `invalidated_by[old_uuid] = [new_uuid]` 매핑을 남긴다 (= superseded_by).
7. **검색**: `search_memory_facts`는 `valid_at_*`/`invalid_at_*` 범위 필터를 노출한다. 만료된 edge를 기본으로 제외하지는 않는다(`search/search_filters.py`의 `expired_at` 필터는 옵션). 판단은 소비자 몫이다.

핵심 통찰: **"모순인가?"(의미 판정, LLM)와 "어느 쪽이 이기나?"(시간 비교, 결정적 코드)를 분리**한다. LLM이 recency로 판단하지 못하게 막고, 승패는 `valid_at` 비교로만 정한다.

## 4. 프롬프트에서 가져올 것

**A. Contradiction 판정 가드레일** (`dedupe_edges.py`) — 큐레이터 프롬프트에 거의 그대로 옮긴다:
- "Only mark contradicted when the NEW and existing fact **cannot both be true**."
- "Do NOT infer contradiction from recency alone, dates, weekly snapshots, section headings like 'updates', or a new event involving the same entities."
- "Progress/activity facts do NOT contradict role/ownership facts." 우리 버전: *새 attempt 기록은 기존 finding을 반박하지 않는다. 결론이 명시적으로 뒤집혔을 때만 반박이다.*
- "NEVER mark as duplicate if key differences in numbers, dates, qualifiers." 버전 번호나 벤치 수치가 다르면 별개 finding이다.
- 예시 3종 패턴: 동일 → duplicate / 같은 관계에서 값만 변경 → contradicted (duplicate 아님) / 다른 날 다른 사건 → 둘 다 아님.

**B. Entity resolution** (`dedupe_nodes.py`, `dedup_helpers.py`):
- 3단 cascade: ① 정규화(lowercase, 공백 축약) exact match → ② 이름 entropy가 충분할 때만 MinHash/LSH fuzzy(Jaccard ≥ 0.9) → ③ 애매하면 LLM. exact match가 여러 개면 LLM으로 escalate한다.
- "duplicate only if *same real-world object*. related-but-distinct는 NO. **unsure면 -1(새로 만들기)**." 잘못 병합하는 비용이 잘못 분리하는 비용보다 크다.
- 반례(Java 섬 vs Java 언어)를 프롬프트 예시에 넣는다.

**C. Extraction 규칙** (`extract_edges.py`): "NEVER generalize". 고유명사·버전·수치·에러코드를 fact 문장에 그대로 남긴다. 더 구체적인 후속 정보는 duplicate이 아니라 새 fact다. 상대 시간("지난주")은 reference_time 기준 절대 시각으로 바꾼다.

**D. MCP instructions** (`mcp_server/src/graphiti_mcp_server.py:136`): 서버 instructions가 ① 데이터 모델 3요소 ② bi-temporal 설명 ③ tool별 한 줄 용도 ④ "descriptive names and detailed content", "specific queries, filter by type/date"를 짧게 담고 있다. 쓰기 tool(`add_memory`)은 비동기 큐 + **group별 순차 처리**(race 방지)다. 우리 플러그인의 SessionStart 주입 텍스트와 skill 설명도 이 4단 구조로 쓴다.

## 5. 마크다운용 변환 규칙 제안 (concrete schema)

### 5.1 매핑

| Graphiti | my-default-env |
|---|---|
| Episode (불변) | `journal/YYYY-MM-DD/<session>.jsonl` 엔트리 (hook이 append-only로 기록) |
| EntityEdge (fact) | `findings/*.md` 1파일 = 1 주장(claim). `attempts/`는 사건(event)이므로 무효화 대상이 아님 |
| EntityNode | `entities/<slug>.md` (선택) 또는 frontmatter `about: [[...]]` |
| `episodes[]` provenance | `sources:` (journal 엔트리 id / commit / URL) |
| `expired_at` + `invalidated_by` | `status: superseded` + `superseded_by` |
| community / INDEX | `INDEX.md` — active만 라우팅 |

### 5.2 Frontmatter (findings / research 공통)

```yaml
---
id: F-2026-10-21-sqlite-wal-lock        # 불변. 파일명과 동일. rename 금지
type: finding                           # finding | research | attempt | entity
claim: "Windows에서 SQLite WAL은 네트워크 드라이브에서 lock 실패한다 (sqlite 3.46)"
about: ["[[sqlite]]", "[[windows]]"]    # entity 링크 (≈ edge endpoints)
status: active                          # active | superseded | retracted | disputed
valid_from: 2026-10-21                  # 현실에서 참이 된 시점 (valid_at). 모르면 생략
valid_until:                            # 현실에서 끝난 시점 (invalid_at). 명시적 종료일 때만
recorded: 2026-10-21T09:12:00+09:00     # 기록 시각 (created_at). 자동
superseded_at:                          # 무효 처리한 시각 (expired_at). 자동
superseded_by: []                       # ["[[F-2026-11-02-sqlite-wal-fixed]]"]
supersedes: []                          # 역방향 링크 (양방향 유지)
sources: ["journal:2026-10-21/abc123#L40", "commit:1a2b3c"]   # provenance, 1개 이상 필수
confidence: high                        # high | medium | low
---
```

규칙:
- `status` 의미: `active`=현재 믿음 / `superseded`=더 새 사실로 대체됨(히스토리로는 유효) / `retracted`=처음부터 틀렸음 / `disputed`=모순은 감지됐으나 시간으로 판정할 수 없음, 사람 확인 필요.
- 무효화할 때 **파일 삭제와 본문 수정은 금지**한다. frontmatter만 바꾸고 본문 맨 위에 `> SUPERSEDED by [[...]] (2026-11-02): 한 줄 사유` 배너를 추가한다.
- `valid_from`이 없으면 표시용으로 `recorded`를 대신 쓰지만, 시간 비교로 승패를 가릴 때는 쓰지 않는다. 이 경우는 `disputed`로 보낸다.
- 미래 계획("다음 주에 v2로 올린다")은 finding이 아니다. `valid_from`에 미래 날짜를 쓰지 않는다(Graphiti 규칙과 같음).
- `attempts/`는 사건 로그라서 `status` 대신 `outcome: success|fail|partial`만 쓴다. attempt는 반박당하지 않는다. 대신 finding이 attempt를 `sources`로 인용한다.

### 5.3 큐레이션 시 모순 처리 절차 (curator agent 지시문)

1. 새 claim의 `about` entity 목록으로 기존 노트를 찾는다. **같은 entity 집합**이면 duplicate 후보 (Graphiti `related_edges`).
2. `rg`/키워드로 `findings/` 전체에서 의미가 비슷한 노트를 찾는다. 이것이 invalidation 후보 (Graphiti `existing_edges`). 리스트마다 상한 ~10.
3. 정규화한 `claim` 문자열이 정확히 일치하면 LLM 없이 duplicate으로 처리하고, 기존 노트 `sources`에 append만 한다.
4. LLM 판정(§4-A 가드레일 그대로) → `{duplicates: [...], contradicted: [...]}`.
5. 승패는 결정적 규칙으로 정한다:
   - 구간이 겹치지 않으면 둘 다 `active` (예: "v1.2에서는 X", "v1.3부터 Y"를 `valid_until`/`valid_from`으로 표현).
   - old.valid_from < new.valid_from → old는 `status: superseded`, `valid_until = new.valid_from`, `superseded_at = now`, `superseded_by += new`. new는 `supersedes += old`.
   - new.valid_from < old.valid_from (늦게 들어온 옛 정보) → **new를 superseded 상태로 생성**한다.
   - 날짜로 판정할 수 없으면 둘 다 `disputed`로 두고 `INDEX.md`의 "## Disputed" 섹션에 올린다.
6. `INDEX.md` 재생성: `status: active`만 라우팅하고, superseded는 "History" 접힘 섹션에 링크만 둔다.
7. 검증 스크립트(lint, CI/hook): `superseded_by` 대상 존재 + 역링크 일치, `sources` ≥ 1, `supersedes` 순환 없음, `id`==파일명.

### 5.4 Entity resolution (파일 생성 전)

- 새 `[[entity]]` 링크를 만들기 전에: slug 정규화(lowercase, `-`) exact match → `entities/`의 aliases 매칭 → 애매하면 LLM에 "같은 실세계 대상인가? 불확실하면 새로 만든다"를 묻는다.
- `entities/<slug>.md` frontmatter에 `aliases: [NYC, New York]`를 유지한다 (Obsidian 호환).

## 6. 실제 Graphiti 도입 기준

다음 중 **2개 이상**이 계속되면 도입을 검토한다 (FalkorDB Lite/Kuzu 같은 embedded 드라이버부터):
- active findings가 수천 건 이상(대략 >2,000)이어서 `rg` + LLM 판정의 비용과 누락이 체감될 때.
- 큐레이션 때 invalidation 후보가 키워드 검색에 안 잡혀 **모순 누락**이 반복될 때 (의미 검색 필요).
- "2026-03 시점에 우리가 믿던 것은?" 같은 **point-in-time 질의**가 실제 업무에서 주기적으로 필요할 때.
- 여러 저장소/팀이 지식을 공유하고(`group_id` 파티션) 동시 쓰기로 git merge conflict가 일상이 될 때.
- entity 간 multi-hop 관계 탐색(라이브러리 → 의존 → 버그 → 우회책)이 주된 사용 패턴일 때.
- 외부 구조화 데이터(JSON 이벤트, 티켓 시스템)가 대량으로 자동 유입될 때.

도입하지 말아야 할 신호: 단일 저장소·단일 개발자, findings가 수백 건 미만, 사람이 `INDEX.md`로 충분히 길을 찾을 수 있음, DB 운영 부담(Windows에서 Docker 필요)이 이득보다 큼.

**이행 경로**: 위 schema는 손실 없이 매핑된다. 노트 1개 → `add_triplet`(또는 `add_memory` episode), `valid_from/valid_until/recorded/superseded_at` → `valid_at/invalid_at/created_at/expired_at`, `about` → endpoint entities, `sources` → episodes. 마크다운을 source of truth로 두고 Graphiti는 파생 인덱스로 쓰는 편이 안전하다.

## 7. 출처

- `.vendor/graphiti/graphiti_core/edges.py:263` — `EntityEdge` 필드 정의
- `.vendor/graphiti/graphiti_core/nodes.py:54,318,499` — `EpisodeType`, `EpisodicNode`, `EntityNode`
- `.vendor/graphiti/graphiti_core/utils/maintenance/edge_operations.py:424` (`resolve_extracted_edges`), `:715` (`_apply_temporal_invalidation`), `:747` (`resolve_edge_contradictions`), `_dedupe_extracted_edge`
- `.vendor/graphiti/graphiti_core/utils/maintenance/temporal_edge_utils.py` — 미래형 정규화
- `.vendor/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py` — exact → MinHash/LSH → LLM cascade
- `.vendor/graphiti/graphiti_core/prompts/dedupe_edges.py`, `dedupe_nodes.py`, `extract_edges.py`
- `.vendor/graphiti/graphiti_core/search/search_filters.py` — 시간 필터
- `.vendor/graphiti/mcp_server/src/graphiti_mcp_server.py:136` (instructions), `:403` (`add_memory`), `:616` (`search_memory_facts`)
- 라이선스: Apache-2.0 (`.vendor/graphiti/LICENSE`). 프롬프트 문구를 그대로 옮기면 NOTICE/출처 표기가 필요하다.
