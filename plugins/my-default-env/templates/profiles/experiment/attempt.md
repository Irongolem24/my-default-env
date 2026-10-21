---
id: {{id}}
title: "{{title}}"
type: attempt
permalink: {{permalink}}
created: {{now}}
modified: {{now}}
tags: []
outcome: pending
priority: normal
when: ""
derived_from: []
depends_on: []
sources: []
model: ""
score: ""
---
# {{title_raw}}

<!--
실험 1회(또는 같은 설정의 묶음) = attempt 1개. 변형은 새 attempt + derived_from으로 잇는다.
outcome: success | fail | partial | pending | abandoned · model: 모델/도구와 버전 · score: 평가 점수(있으면)
결과물은 .knowledge/assets/<이 파일 stem>/ 에 두고 아래에 상대 경로로 링크한다 (git LFS).
-->

## 목적 / 확인하려는 한계

## 모델·도구와 설정

| 항목 | 값 |
|---|---|
| 모델 | |
| 파라미터 | |
| 연결 구조 (예: Astra → Opus 루프) | |

## 프롬프트

```text
```

## 참조 입력

## 출력

## 평가 (관찰한 것, 점수, 비교 대상)

## 판정과 원인

## 다음 변형
