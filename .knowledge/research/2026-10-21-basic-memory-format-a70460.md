---
id: res-a70460
title: "Basic Memory 노트 포맷과 호환 조건"
type: research
permalink: research/2026-10-21-basic-memory-format-a70460
created: 2026-10-21T11:03:50.977+09:00
modified: 2026-10-21T11:03:50.977+09:00
tags: [basic-memory, format]
status: active
retrieved: 2026-10-21
sources: [docs/research/basic-memory.md]
priority: normal
when: ""
---
# Basic Memory 노트 포맷과 호환 조건

## 요약
AGPL-3.0이라 코드는 쓰지 않고 형식만 맞춘다. title/type/permalink를 우리가 직접 쓰면 BM이 파일을 다시 쓰지 않는다.

## 핵심 내용
- 한글 permalink는 음역된다 (실험 → silheom) → 파일명은 ASCII.
- `bm_parse_semantics: false` = 검색은 되지만 그래프에는 안 들어감 → journal notes에 사용.
- 본문 산문의 `#단어`는 태그로 오인된다.
- 프로젝트 등록은 `.knowledge` 폴더 자체로 (레포 루트로 하면 dot 폴더라 무시됨).

## 출처
docs/research/basic-memory.md
