---
id: res-d86bac
title: "Beads 데이터 모델과 에이전트 연동"
type: research
permalink: research/2026-10-21-beads-model-d86bac
created: 2026-10-21T11:03:50.984+09:00
modified: 2026-10-21T11:03:50.984+09:00
tags: [beads]
status: active
retrieved: 2026-10-21
sources: [docs/research/beads.md]
priority: normal
when: ""
---
# Beads 데이터 모델과 에이전트 연동

## 요약
현재 Dolt DB 기반 (JSONL은 export일 뿐). discovered-from 같은 비차단 계보 링크, 해시 id, bd prime 상한 주입.

## 우리에게 의미하는 것
해시 id와 derived_from/depends_on 계보만 가져왔다. bd 자체는 필요한 프로젝트에서만 쓰는 candidate.

## 출처
docs/research/beads.md
