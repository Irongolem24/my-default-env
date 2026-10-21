---
name: recall
description: Look up what this project already knows before acting — past attempts, findings, research, and raw journal — via .knowledge/INDEX.md routing and search. Use when starting a task that may have been tried before, when hitting an error or limit, or when the user asks "전에 어떻게 했지", "이거 해봤나", "what did we learn about X".
---
# recall

`.knowledge/`에서 지금 필요한 것만 찾아 읽는다. 전부 읽지 않는다.

1. `.knowledge/INDEX.md`의 "0. 먼저 읽기", "1. 상황별 라우팅"에서 지금 질문과 맞는 항목을 고른다.
2. 키워드 검색 (한글·영문 동의어를 같이): `rg -i -n "<키워드1>|<키워드2>" .knowledge/findings .knowledge/attempts .knowledge/research`
3. 노트를 열 때:
   - finding이 `status: superseded`면 `superseded_by`를 따라가서 현재 사실을 읽는다. `disputed`면 양쪽을 다 보여 준다.
   - 큰 문서는 목차(`<!-- toc:start -->`)에서 해당 섹션만 읽는다.
   - attempt는 `derived_from` 계보를 따라가며 무엇이 바뀌었는지 본다.
4. 정리된 노트에 없으면 원본을 찾는다: `rg -i -l "<키워드>" .knowledge/journal` → `node .knowledge/bin/kn.cjs digest <journal 상대경로>`로 압축 보기 (원본 전체를 읽지 않는다).
5. 답할 때 각 주장 옆에 근거 노트 경로를 붙인다. 원본에서만 찾은 내용은 "(정리 안 된 원본 기록)"이라고 밝히고, 다음 curate 때 승격 대상이라고 알린다.
6. 찾지 못했으면 못 찾았다고 말한다. 추측으로 채우지 않는다.
