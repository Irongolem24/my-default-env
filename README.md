# my-default-env

Claude Code와 Codex CLI에서 같이 쓰는 개인 환경 플러그인입니다. 어떤 프로젝트든 한 번 설치하면 **사람이 연구노트를 쓰듯 모든 작업을 빠짐없이 기록**하고, 기록을 정리해서 AI가 길을 찾을 수 있게 라우팅해 줍니다.

- **강제 기록**: 훅이 프롬프트, 도구 호출, 결과, 생성 이미지를 `.knowledge/journal/`에 자동으로 남깁니다. AI가 기억할 필요가 없습니다.
- **서술 강제**: 작업을 하고 기록 없이 끝내려 하면 Stop 훅이 막고 "무엇을 시도했고, 결과와 원인, 다음 할 일"을 쓰게 합니다.
- **정리와 라우팅**: 시도(attempt), 확정된 사실(finding), 조사(research)를 노트 1개씩으로 승격하고, `INDEX.md`가 우선순위와 상황별로 라우팅합니다. 큰 문서에는 목차가 붙고, 노트 간 링크 그래프가 만들어집니다.
- **사실의 이력**: 사실이 바뀌면 지우지 않고 `superseded` 처리해 언제 무엇을 믿었는지 남깁니다 (Graphiti의 시간 모델).
- **Claude와 Codex가 공유**: 같은 노트, 같은 규칙(AGENTS.md), 같은 훅이 두 호스트에서 돌아갑니다.
- **git 기본, 이미지는 LFS**.

## 설치

필요한 것: Node.js 18 이상, git, [git-lfs](https://git-lfs.com).

```bash
# Claude Code
claude plugin marketplace add Irongolem24/my-default-env
claude plugin install my-default-env@my-default-env

# Codex CLI
codex plugin marketplace add Irongolem24/my-default-env
codex plugin add my-default-env@my-default-env
# 그 다음 '새 대화형' codex 세션에서 /hooks → my-default-env 훅을 승인 (승인 전에는 기록되지 않음)
```

## 프로젝트에 적용

프로젝트 폴더에서:

| 호스트 | 명령 |
|---|---|
| Claude Code | `/my-default-env:env-init experiment` |
| Codex | `$env-init experiment` |
| 직접 | `node <플러그인 경로>/bin/kn.cjs init --profile experiment` |

프로필은 전체 틀은 같고 시도 기록 양식과 규칙만 다릅니다.

| 프로필 | 용도 | 시도 1건의 기록 항목 |
|---|---|---|
| `code` | 소프트웨어 개발 | 증상, 가설, 변경, 실제로 돌린 검증 명령과 결과 |
| `experiment` | 이미지 생성, 모델 한계 탐색, 멀티모델 루프 | 모델과 버전, 프롬프트 원문, 참조 입력, 파라미터, 결과물(LFS), 평가 |
| `automation` | 업무 자동화, 검증 업무 | 절차, 입력 케이스, 기대값과 실제값, 예외, 재현 방법 |
| `creative` | 초안 → 비평 → 수정 루프 | 버전, 이전 버전, 비평 출처(사람/모델), 반영한 변경 |

적용하면 프로젝트에 생기는 것:

```
AGENTS.md            ← 연구노트 규칙 블록 추가 (Claude와 Codex 공용, 블록 밖 내용은 보존)
CLAUDE.md            ← 없으면 @AGENTS.md 한 줄
.gitattributes       ← 이미지 LFS 규칙
.knowledge/
├─ INDEX.md          ← 먼저 읽기 / 상황별 라우팅 / 진행 중 / 최근 시도 / 주제 / 허브 / 큰 문서 목차 / 분쟁 / 이력
├─ journal/<날짜>/   ← *.jsonl 훅 원본, notes.md 에이전트 서술
├─ attempts/  findings/  research/  entities/
├─ assets/           ← 이미지 등 결과물 (LFS)
├─ templates/  templates.local/
├─ graph.json
└─ bin/kn.cjs        ← CLI (플러그인 없이도 동작)
```

## 스킬

| 스킬 | 하는 일 |
|---|---|
| `env-init` | 프로젝트에 `.knowledge/` 적용 |
| `env-upgrade` | 플러그인 새 버전의 틀로 갱신 (노트는 보존) |
| `log-attempt` | 시도 1건을 구조화해서 기록 |
| `recall` | INDEX 라우팅과 검색으로 이미 아는 것을 찾기 |
| `curate` | journal 원본을 attempt/finding/research로 승격, 모순 처리, INDEX 재생성 |

## kn CLI

```
node .knowledge/bin/kn.cjs help
  new attempt|finding|research|entity --title "..."   note --title "..." "본문"
  supersede <옛 id> <새 id>   index   lint [--fix]   toc <file>
  pending   digest <journal 파일>   mark-curated --all   status   context
```

## 환경 관리 (이 저장소)

`registry.json`이 이 환경에서 쓰는 모든 플러그인, CLI, MCP를 상태와 함께 기록합니다. 상태는 `adopted`, `trial`, `candidate`, `deprecated`, `rejected` 중 하나입니다.

```bash
node scripts/env.cjs status     # 무엇이 설치돼 있나
node scripts/env.cjs plan       # adopted/trial 중 빠진 것의 설치 명령
node scripts/env.cjs apply --yes
node scripts/env.cjs review     # 재검토 날짜가 지난 항목
```

새 도구를 들일 때는 `.vendor/`에 clone한 뒤 `docs/research/<도구>.md`에 분석을 남기고, `trial`로 등록합니다. 써 본 다음 `adopted` 또는 `rejected`로 바꾸고 이유를 `why`에 남깁니다. 구조와 결정의 근거는 [docs/DESIGN.md](docs/DESIGN.md)에 있습니다.

## 개발

```bash
node --test tests/kn.test.cjs
claude plugin validate plugins/my-default-env
claude --plugin-dir plugins/my-default-env      # 로컬 테스트
```

## 라이선스

MIT. 참고한 프로젝트와 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.
