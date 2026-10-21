---
name: env-init
description: Set up the my-default-env research notebook (.knowledge/, AGENTS.md rules, git + LFS) in the current project with a profile (code, experiment, automation, creative). Use when the user asks to initialize/apply my-default-env or the knowledge notebook to a project.
argument-hint: "<code|experiment|automation|creative>"
disable-model-invocation: true
---
# env-init

요청 인자: $ARGUMENTS

`kn.cjs` 위치: Claude Code에서는 `${CLAUDE_PLUGIN_ROOT}/bin/kn.cjs`. Codex 등 치환이 안 되는 곳에서는 이 SKILL.md 파일 기준 `../../bin/kn.cjs` 경로다 (이 파일의 실제 경로로 계산할 것). 프로젝트에 이미 `.knowledge/bin/kn.cjs`가 있으면 그것을 써도 된다.

1. 프로필을 정한다. 인자가 있으면 그대로 쓴다. 없으면 프로젝트를 보고 하나를 추천하고 사용자에게 확인받는다.
   - `code`: 소프트웨어 개발
   - `experiment`: 이미지 생성, 모델 한계 탐색, 멀티모델 루프 실험
   - `automation`: 업무 자동화, 검증 업무, 반복 처리
   - `creative`: 초안 → 비평 → 수정 반복 창작
2. 이미 `.knowledge/config.json`이 있으면 init 대신 env-upgrade를 안내한다 (프로필을 바꾸려면 플러그인의 kn.cjs로 `init --profile <새 프로필>`을 다시 실행한다. 노트는 보존되고 새 프로필의 설정값이 적용된다).
3. 프로젝트 루트에서 실행: `node <kn.cjs> init --profile <프로필>`
4. 출력 로그를 사용자에게 요약한다. 특히:
   - AGENTS.md / CLAUDE.md를 만들었는지, 기존 파일에 블록을 덧붙였는지
   - git init, git lfs 설치 여부, 건너뛴 LFS 규칙 (WARN이 있으면 해결 방법 안내. 이미 커밋된 이미지가 있어 건너뛴 규칙은 `git lfs migrate import`로 옮길지 사용자에게 묻는다 — 히스토리를 다시 쓰므로 임의로 실행하지 않는다)
   - Codex를 쓴다면: 새 대화형 codex 세션에서 `/hooks`로 my-default-env 훅을 승인해야 기록이 시작된다는 것
5. 프로젝트에 이미 정리돼 있던 문서(README의 시행착오, docs/의 결정 기록 등)가 있으면, 그중 중요한 것을 finding/research로 옮길지 사용자에게 제안한다. 옮길 때는 `kn.cjs new finding --title ...`로 만든 뒤 내용을 채우고 `kn.cjs index`.
6. 변경된 파일을 커밋할지 묻는다 (임의로 커밋하지 않는다).
