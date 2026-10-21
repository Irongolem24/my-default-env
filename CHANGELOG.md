# Changelog

## 0.2.0 — 2026-10-21

- Codex를 Claude CLI에서 부르는 흐름을 기록하도록 맞췄다. 공식 플러그인 `openai/codex-plugin-cc`와 c2c-img가 대상이다.
- `codex-companion.mjs task|review|adversarial-review`와 `c2c_img.py` 호출은 서브에이전트 안에서 실행돼도 Stop 집계의 "작업"으로 센다.
- 위 호출의 출력은 `capture.maxDelegate`(기본 20000자)까지 남긴다.
- 프로젝트 밖에 저장된 c2c-img 이미지를 `.knowledge/assets/generated/`로 복사해 LFS로 올라가게 하고, journal의 `generated`에 경로를 남긴다.
- AGENTS 규칙에 Codex에 맡긴 일의 기록 방법과 c2c-img 저장 위치를 추가했다.
- registry에 `codex-plugin-cc`를 추가했다.

## 0.1.0 — 2026-10-21

- 첫 버전.
- 훅이 journal을 자동 기록한다.
- Stop 훅이 서술 기록을 강제한다.
- kn CLI: init, upgrade, new, note, supersede, index, lint, toc, pending, digest, mark-curated, status, context.
- 스킬 5개: env-init, env-upgrade, log-attempt, recall, curate.
- 프로필 4개: code, experiment, automation, creative.
- 이미지는 git LFS로 추적한다.
- `registry.json`과 `scripts/env.cjs`로 환경을 관리한다.
- Claude Code 2.1.305와 Codex CLI 0.159.3(Windows)에서 실측 검증했다.
