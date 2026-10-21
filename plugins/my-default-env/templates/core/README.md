# .knowledge — 프로젝트 연구노트

[my-default-env](https://github.com/Irongolem24/my-default-env)가 설치한 폴더. 사람과 AI(Claude, Codex)가 같이 읽고 쓴다.

| 경로 | 내용 | 누가 쓰나 |
|---|---|---|
| `INDEX.md` | 우선순위·상황별 라우팅, 진행 중인 시도, 주제, 허브, 큰 문서 목차 | `kn index`가 생성 (수동 메모 영역은 보존) |
| `journal/<날짜>/*.jsonl` | 프롬프트·도구 호출·결과 원본 (비밀값 마스킹, 긴 출력은 앞뒤만) | 훅이 자동 기록 |
| `journal/<날짜>/notes.md` | 작업 구간별 서술 기록 | 에이전트 (Stop 훅이 강제) |
| `attempts/` | 시도·실험 1건 = 파일 1개 (실패 포함) | 에이전트, curate |
| `findings/` | 확정된 사실 1개 = 파일 1개, 대체되면 이력으로 남음 | 에이전트, curate |
| `research/` | 조사한 외부 정보와 출처 | 에이전트, curate |
| `entities/` | 반복 등장하는 대상 (도구, 모델, 시스템) | curate |
| `assets/` | 이미지 등 결과물 (git LFS) | 훅, 에이전트 |
| `templates/` | 노트 템플릿 (플러그인 소유, upgrade 때 덮어씀) | — |
| `templates.local/` | 이 프로젝트 전용 템플릿 (templates/보다 우선) | 사람 |
| `graph.json` | 노트 간 링크 그래프 | `kn index` |
| `bin/kn.cjs` | CLI (`node .knowledge/bin/kn.cjs help`) | — |

노트는 Basic Memory 형식과 호환된다. 원하면 `basic-memory project add <이름> "<이 폴더 경로>"`로 그래프 검색 MCP를 붙일 수 있다.
