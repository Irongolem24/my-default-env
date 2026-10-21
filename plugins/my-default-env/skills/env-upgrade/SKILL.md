---
name: env-upgrade
description: Upgrade a project's .knowledge/ notebook to the installed my-default-env plugin version (refreshes kn.cjs, templates, AGENTS.md block; keeps all notes). Use when the user asks to update/upgrade the notebook environment in a project.
disable-model-invocation: true
---
# env-upgrade

`kn.cjs` 위치: Claude Code에서는 `${CLAUDE_PLUGIN_ROOT}/bin/kn.cjs`. Codex 등 치환이 안 되는 곳에서는 이 SKILL.md 파일 기준 `../../bin/kn.cjs` 경로다 (이 파일의 실제 경로로 계산할 것). 프로젝트에 이미 `.knowledge/bin/kn.cjs`가 있으면 그것을 써도 된다. 반드시 **플러그인 쪽** kn.cjs를 쓴다 (프로젝트 사본은 구버전일 수 있다).

1. `node .knowledge/bin/kn.cjs version`과 `node <플러그인 kn.cjs> version`을 비교해 사용자에게 보여 준다.
2. `node <플러그인 kn.cjs> upgrade` 실행. 노트, journal, templates.local/, AGENTS.md의 블록 밖 내용은 보존된다.
3. `node .knowledge/bin/kn.cjs lint --fix` → 남은 ERROR가 있으면 고친다 (새 버전 규칙 때문일 수 있다).
4. `node .knowledge/bin/kn.cjs index`
5. `git diff --stat`으로 바뀐 파일을 보여 주고 커밋할지 묻는다.
6. Codex 사용자라면: 플러그인 업데이트로 훅 파일이 바뀌었으면 새 codex 세션에서 `/hooks` 재승인이 필요할 수 있다고 알린다.
