---
id: res-469e65
title: "claude-mem 구조 분석"
type: research
permalink: research/2026-10-21-claude-mem-analysis-469e65
created: 2026-10-21T11:03:50.972+09:00
modified: 2026-10-21T11:03:50.972+09:00
tags: [claude-mem, hooks]
status: active
retrieved: 2026-10-21
sources: [docs/research/claude-mem.md, https://github.com/thedotmack/claude-mem@bbb3379]
priority: normal
when: ""
---
# claude-mem 구조 분석

## 요약
데몬(Bun) + SQLite/Chroma + 도구 호출마다 Haiku 요약. 원본이 아니라 요약만 저장한다 → 우리 원본 우선 설계와 반대. Apache-2.0.

## 핵심 내용
- 훅 IO 규율: stdout JSON 1회, exit 2 금지, 실패 시 빈 출력 + exit 0.
- SessionStart 주입 상한 10,000자, 넘으면 단계적으로 줄인다.
- Codex SessionStart 출력엔 hookSpecificOutput이 필요하고 Stop에는 붙이면 안 된다.

## 우리에게 의미하는 것
IO 규율, truncation, 이미지 추출, redaction만 재구현. 아키텍처는 기각 (registry: rejected).

## 출처
docs/research/claude-mem.md
