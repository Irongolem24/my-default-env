---
name: log-attempt
description: Record one trial/experiment/run as a structured attempt note in .knowledge/attempts/ (goal, inputs, settings, outputs, verdict, cause), including failures. Use right after trying something whose result matters later — a generation run, a fix attempt, a verification run, a prompt variant — or when the user says "기록해", "남겨둬", "log this".
---
# log-attempt

시도 1건을 `.knowledge/attempts/`에 남긴다. 실패한 시도도 반드시 남긴다.

1. 이번 대화에서 기록할 시도를 정한다. 여러 개면 각각 따로 만든다 (변수가 다르면 다른 시도).
2. 이어받은 이전 시도가 있으면 찾는다: `rg -l "<키워드>" .knowledge/attempts` → 그 id를 `derived_from`에 쓴다.
3. 생성: `node .knowledge/bin/kn.cjs new attempt --title "<무엇을 바꿨는지 드러나는 제목>" [--slug ascii-name] --field outcome=<success|fail|partial|pending|abandoned>`
   - 제목이 한글뿐이면 `--slug`로 짧은 영문 이름을 준다.
4. 생성된 파일의 섹션을 **사실만으로** 채운다:
   - 프롬프트, 명령, 파라미터는 원문 그대로 (요약하지 않는다)
   - 결과물 파일은 `.knowledge/assets/<파일 stem>/`로 옮기거나 복사하고 상대 경로로 링크
   - "판정과 원인"에는 관찰과 추측을 구분해서 쓴다 ("관찰: … / 추정 원인: …")
   - `sources:`에 원본 journal 경로(`journal:<날짜>/<파일>.jsonl`)를 넣는다
   - 다시 볼 상황이 떠오르면 `when:` 한 줄
5. 이 시도로 확정된 사실이 생겼으면 finding도 만든다 (`new finding`, claim 한 문장, sources에 이 attempt id).
6. `node .knowledge/bin/kn.cjs index` 후 만든 파일 경로를 사용자에게 알려 준다.
