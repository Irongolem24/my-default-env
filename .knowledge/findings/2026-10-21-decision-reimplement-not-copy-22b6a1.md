---
id: fnd-22b6a1
title: "결정: 외부 도구 코드는 복사하지 않고 재구현, Basic Memory는 형식 호환만"
type: finding
permalink: findings/2026-10-21-decision-reimplement-not-copy-22b6a1
created: 2026-10-21T11:03:51.000+09:00
modified: 2026-10-21T11:03:51.000+09:00
tags: [license, decision]
claim: "결정: 공개 MIT 저장소이므로 외부 도구 코드는 복사하지 않고 아이디어만 재구현하며, AGPL인 Basic Memory는 노트 형식 호환만 유지한다"
about: []
status: active
valid_from: 2026-10-21
valid_until: ""
recorded: 2026-10-21T11:03:51.000+09:00
superseded_at: ""
superseded_by: []
supersedes: []
sources: ["[[res-a70460]]", "[[res-469e65]]", THIRD_PARTY_NOTICES.md]
confidence: high
priority: high
when: "외부 플러그인·스킬에서 코드를 가져오려 할 때"
---
# 결정: 외부 도구 코드는 복사하지 않고 재구현, Basic Memory는 형식 호환만

## 근거
claude-mem·Graphiti는 Apache-2.0(복사 시 NOTICE 필요), Beads는 MIT, Basic Memory는 AGPL-3.0(복사하면 저장소 전체가 AGPL 영향). 필요한 부분이 작아서 재구현 비용이 낮았다.

## 기각한 대안
- 코드 copy-adapt + NOTICE: 가능하지만 우리 코드 스타일(zero-dep 단일 파일)과 맞지 않음.
- 네 도구를 그대로 설치해 조합: 정본이 여러 개가 되고 Codex 공유가 안 됨.
