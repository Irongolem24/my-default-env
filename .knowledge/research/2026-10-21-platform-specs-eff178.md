---
id: res-eff178
title: "Claude Code와 Codex 플러그인·훅 스펙 비교"
type: research
permalink: research/2026-10-21-platform-specs-eff178
created: 2026-10-21T11:03:50.987+09:00
modified: 2026-10-21T11:03:50.987+09:00
tags: [codex, hooks, plugin]
status: active
retrieved: 2026-10-21
sources: [docs/research/platform-specs.md, docs/research/codex-hook-schemas-0.159.3/]
priority: high
when: "훅이나 플러그인 매니페스트를 고칠 때"
---
# Claude Code와 Codex 플러그인·훅 스펙 비교

## 요약
Codex 0.159.3은 Claude 플러그인 형식을 그대로 읽는다. 출력 스키마가 strict라 교집합만 써야 한다. Codex 훅은 trust 승인 전에는 조용히 건너뛴다.

## 출처
docs/research/platform-specs.md (함정 15개는 7절)
