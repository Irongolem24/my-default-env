---
id: fnd-3715dd
title: "Windows의 Codex는 훅 명령을 PowerShell로 실행하므로 node -e 형식을 쓴다"
type: finding
permalink: findings/2026-10-21-codex-hooks-run-in-powershell-3715dd
created: 2026-10-21T11:03:50.992+09:00
modified: 2026-10-21T11:03:50.992+09:00
tags: [codex, windows, hooks]
claim: "Windows에서 Codex는 훅 command를 PowerShell로, Claude Code는 Git Bash로 실행하므로 $·역슬래시·이중따옴표 없는 node -e 명령 하나로 두 셸을 모두 지원한다"
about: ["[[codex]]", "[[windows]]"]
status: active
valid_from: 2026-10-21
valid_until: ""
recorded: 2026-10-21T11:03:50.992+09:00
superseded_at: ""
superseded_by: []
supersedes: []
sources: ["[[res-eff178]]", "tests/kn.test.cjs: hooks.json commands use the shell-neutral node -e form", "Codex 실측 2026-10-21"]
confidence: high
priority: critical
when: "hooks.json의 command를 고칠 때"
---
# Windows의 Codex는 훅 명령을 PowerShell로 실행하므로 node -e 형식을 쓴다

## 내용
`${CLAUDE_PLUGIN_ROOT}` 같은 셸 변수 전개는 PowerShell에서 PS 변수로 해석돼 빈 값이 된다. 경로는 node가 process.env에서 직접 읽게 한다.

## 적용 방법
`node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT||process.env.PLUGIN_ROOT,'hooks','run.cjs'))" <event>` — 테스트가 이 형식을 강제한다.
