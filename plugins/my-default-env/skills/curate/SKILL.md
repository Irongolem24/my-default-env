---
name: curate
description: Distill the raw .knowledge/journal (hook-captured prompts/tool calls and agent notes) into curated attempts, findings, research and entities, resolve contradictions by supersession, then rebuild INDEX.md. Use when the session-start context or a hook says curation is recommended, at the end of a big work block, or when the user asks to 정리/curate the notebook.
---
# curate

원본(journal) → 정리된 노트로 승격한다. 원본은 절대 지우거나 고치지 않는다.

## 1. 범위 파악
- `node .knowledge/bin/kn.cjs pending` → 미정리 파일 목록 (`path@size  from=N`). 이 `path@size`를 그대로 들고 다닌다.
- 각 파일을 `node .knowledge/bin/kn.cjs digest <path@size> --from <N>`으로 읽는다 (`notes.md`는 원문, `*.jsonl`은 압축 보기). 원본 줄 전체가 필요할 때만 jsonl을 직접 연다.
- 양이 많으면 날짜/세션 단위로 나눠서 반복한다.

## 2. 추출 (무엇을 남기나)
- **attempt**: 독립된 시도마다 1개. 이미 해당 attempt 파일이 있으면 새로 만들지 말고 보강만 한다 (`rg -l` 로 확인).
- **finding**: 반복 확인됐거나 근거가 분명한 사실, 원인이 밝혀진 문제, 내린 결정. claim은 대명사 없이 혼자 읽히는 한 문장. sources에 attempt id나 journal 경로 1개 이상.
- **research**: 웹·문서에서 조사한 내용 (URL과 조회일).
- **entity**: 여러 노트에서 반복 등장하는 도구·모델·시스템. 만들기 전에 기존 entities/의 title·aliases와 같은 대상인지 확인하고, 애매하면 새로 만든다 (잘못 합치는 것이 잘못 나누는 것보다 비싸다).
- 남기지 않는 것: 이미 기록된 사실의 재확인, 빈 검색, 단순 상태 확인, 설치 성공 메시지.

## 3. 모순 처리 (finding마다)
1. 같은 `about:` entity를 가진 기존 finding과 키워드가 비슷한 finding을 찾는다 (`rg`).
2. claim이 사실상 같으면 새로 만들지 않고 기존 노트 `sources`에 근거만 추가한다.
3. **둘 다 참일 수 없을 때만** 모순이다. 날짜가 다르거나 새 정보라는 이유만으로 모순이라고 보지 않는다. 숫자·날짜·버전이 다르면 다른 사실일 수 있다 (`valid_from`/`valid_until`로 구간을 나눠 둘 다 active로 둘 수 있다).
4. 모순이면 `valid_from`을 비교한다:
   - 옛것이 먼저면 `node .knowledge/bin/kn.cjs supersede <옛 id> <새 id> --reason "..."`
   - 새로 들어온 정보가 더 옛날 시점이면 새 노트를 superseded 상태로 만든다.
   - 날짜로 판단할 수 없으면 둘 다 `status: disputed` → INDEX의 분쟁 섹션에 올라가고, 사용자에게 알린다.

## 4. 라우팅 보강
- 중요한 노트에 `priority: high|critical`, 다시 볼 상황을 `when:`에 한 줄로.
- 관련 노트끼리 본문 "관련" 섹션에 `[[id]]` 링크.
- 150줄이 넘는 문서는 `kn.cjs lint --fix`가 목차를 넣는다. 300줄이 넘으면 주제별로 쪼갤지 검토한다.

## 5. 마무리
1. `node .knowledge/bin/kn.cjs lint --fix` → ERROR가 0이 될 때까지 고친다.
2. `node .knowledge/bin/kn.cjs mark-curated <읽은 path@size ...>` — 1단계에서 받은 값을 그대로 넘긴다. 정리 도중에 새로 쌓인 원본은 다음 curate로 남는다 (`--all`은 쓰지 않는다).
3. `node .knowledge/bin/kn.cjs index`
4. 사용자에게 보고: 새로 만든·보강한 노트 수, supersede/disputed 처리 내역, 다음에 볼 만한 것.
