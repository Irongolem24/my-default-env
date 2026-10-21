---
id: fnd-df7610
title: "Codex 셸에는 CODEX_THREAD_ID가 있고 CLAUDECODE는 부모 Claude에서 상속될 수 있다"
type: finding
permalink: findings/2026-10-21-codex-shell-env-host-detection-df7610
created: 2026-10-21T11:03:50.997+09:00
modified: 2026-10-21T11:03:50.997+09:00
tags: [codex, host-detection]
claim: "Codex가 실행하는 셸에는 CODEX_THREAD_ID가 설정되고, Codex를 Claude 안에서 띄우면 CLAUDECODE 등 CLAUDE_CODE_* 변수도 상속되므로 호스트 판별은 Codex 쪽 변수를 먼저 본다"
about: ["[[codex]]"]
status: active
valid_from: 2026-10-21
valid_until: ""
recorded: 2026-10-21T11:03:50.997+09:00
superseded_at: ""
superseded_by: []
supersedes: []
sources: ["[[att-62e4c4]]", "Codex 실측 2026-10-21: 셸 env 키 목록"]
confidence: high
priority: normal
when: ""
---
# Codex 셸에는 CODEX_THREAD_ID가 있고 CLAUDECODE는 부모 Claude에서 상속될 수 있다

## 근거
실측 env 키: CLAUDECODE, CLAUDE_CODE_SESSION_ID, … CODEX_CI, CODEX_HOME, CODEX_SESSION_ID, CODEX_THREAD_ID, CODEX_VERSION (값은 조회하지 않음).

## 적용 방법
kn.cjs shellHost(): KN_HOST → CODEX_THREAD_ID → CLAUDECODE → human. 훅 쪽은 PLUGIN_ROOT(Codex만 설정)로 판별.
