---
id: res-d54c6f
title: "Graphiti 시간 모델과 모순 처리"
type: research
permalink: research/2026-10-21-graphiti-temporal-model-d54c6f
created: 2026-10-21T11:03:50.981+09:00
modified: 2026-10-21T11:03:50.981+09:00
tags: [graphiti, format]
status: active
retrieved: 2026-10-21
sources: [docs/research/graphiti.md]
priority: normal
when: ""
---
# Graphiti 시간 모델과 모순 처리

## 요약
사실(edge)마다 valid_at/invalid_at(현실 시간)과 created_at/expired_at(기록 시간). 모순 판정은 LLM, 승패는 valid_at 비교로 결정적으로.

## 우리에게 의미하는 것
finding frontmatter(status, valid_from, valid_until, superseded_by …)와 curate 스킬의 모순 처리 절차로 옮겼다. 실제 Graphiti 도입 기준은 research 문서 6절.

## 출처
docs/research/graphiti.md
