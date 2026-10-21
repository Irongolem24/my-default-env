<!-- my-default-env:start -->
## 연구노트 규칙 (my-default-env 0.2.0, profile: code)

이 프로젝트는 `.knowledge/`에 모든 작업을 사람의 연구노트처럼 남긴다. Claude와 Codex가 같은 노트를 공유한다. 이 블록은 `kn upgrade`가 관리하므로 직접 고치지 말고, 프로젝트 고유 규칙은 블록 밖에 쓴다.

**읽기**
- 작업 시작 전에 `.knowledge/INDEX.md`의 "0. 먼저 읽기"와 "1. 상황별 라우팅"을 보고 지금 작업과 관련된 노트만 연다. 큰 문서는 목차의 앵커로 해당 섹션만 읽는다.
- 같은 문제를 다시 풀기 전에 `findings/`와 `attempts/`를 검색한다 (`rg -i "<키워드>" .knowledge`). 이미 실패한 방법을 반복하지 않는다.
- `status: superseded|retracted` 노트는 이력일 뿐이다. 현재 사실은 `superseded_by`를 따라간다.

**쓰기 (강제)** — 아래 `node .knowledge/bin/kn.cjs`는 프로젝트 루트 기준이다. 하위 폴더에서 작업 중이면 세션 시작 컨텍스트에 나온 절대 경로 명령을 쓴다.
- 프롬프트와 도구 사용은 훅이 `journal/`에 자동 기록한다. 이건 원본일 뿐이고 서술은 에이전트가 쓴다.
- 작업 구간을 끝낼 때마다: `node .knowledge/bin/kn.cjs note --title "<요약>" "<시도 / 결과 / 원인·근거 / 막힌 점 / 다음>"`. 기록 없이 끝내려 하면 Stop 훅이 막는다. 본문에 따옴표나 줄바꿈이 많으면 임시 파일에 쓰고 `--file <경로>`로 넘긴다 (PowerShell 인용 문제 회피).
- 독립된 시도·실험 1건 = `kn.cjs new attempt --title "..."` 파일 1개. 실패한 시도도 반드시 남긴다 (실패 이유가 가장 비싼 정보다).
- 확정된 사실 = `kn.cjs new finding --title "..."` (claim은 혼자 읽혀도 이해되는 한 문장, sources 필수). 조사한 외부 정보 = `kn.cjs new research`.
- 사실이 바뀌면 옛 노트를 지우거나 고치지 않는다: `kn.cjs supersede <옛 id> <새 id> --reason "..."`. 날짜로 판단할 수 없는 모순은 둘 다 `status: disputed`.
- 노트를 만들거나 고친 뒤에는 `kn.cjs index`로 INDEX.md를 갱신한다.
- Codex에 맡긴 일(`/codex:rescue`, `/codex:review`, `/codex:adversarial-review`, c2c-img)도 Claude가 기록한다. Codex 내부의 도구 사용은 journal에 남지 않으므로, 맡긴 지시문, Codex의 결론, 실제로 바뀐 파일(`git diff --stat`), Claude의 채택·기각 판단을 note나 attempt에 쓴다. 노트에는 어느 모델이 무엇을 했는지 구분해 적는다.
- c2c-img로 만든 이미지는 가능하면 `-o .knowledge/assets/<attempt stem>/<이름>.png`로 저장한다. `-o` 없이 만든 이미지는 훅이 `.knowledge/assets/generated/`로 복사하고 journal의 `generated`에 경로를 남긴다. attempt에는 그 경로를 링크한다.
- 사람이 나중에 다시 찾을 상황이 떠오르면 frontmatter `when:`에 한 줄로 쓴다. 중요하면 `priority: high|critical`.

**형식**
- 파일명은 ASCII kebab-case (kn이 만들어 준다). 한글은 제목과 본문에.
- 본문 산문에 `#숫자`/`#단어`를 쓰지 않는다 (태그로 오인됨). 이슈 번호는 `PR 42` 또는 `` `#42` ``.
- 이미지·바이너리 결과물은 `.knowledge/assets/` 아래에 두고 노트에서 상대 경로로 링크한다 (git LFS로 추적됨).
- 비밀값(API 키, 토큰, 비밀번호)은 노트에 쓰지 않는다. 원본 기록은 알려진 패턴을 자동 마스킹하지만 완전하지 않다.

**정리**
- 미정리 원본이 쌓이면 curate 스킬(`/my-default-env:curate`, Codex에서는 `$curate`)로 journal → attempts/findings/research로 승격한다.


**profile: code**
- 버그 하나, 기능 하나, 리팩터 하나가 각각 attempt다. 검증 섹션에는 실제로 돌린 명령과 출력만 쓴다 (돌리지 않은 테스트를 통과했다고 쓰지 않는다).
- 원인이 밝혀진 버그, 라이브러리 함정, 환경 이슈는 finding으로 승격하고 `about:`에 관련 entity(라이브러리, 모듈)를 링크한다.
- 설계 결정은 finding으로 남기되 claim에 "결정: …"으로 쓰고 근거와 기각한 대안을 본문에 적는다.
<!-- my-default-env:end -->
