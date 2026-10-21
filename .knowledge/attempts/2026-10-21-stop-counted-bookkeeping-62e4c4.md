---
id: att-62e4c4
title: "Stop 차단이 노트 기록 명령 자체를 미기록 작업으로 셌다"
type: attempt
permalink: attempts/2026-10-21-stop-counted-bookkeeping-62e4c4
created: 2026-10-21T11:03:50.995+09:00
modified: 2026-10-21T11:03:50.995+09:00
tags: [hooks, stop]
outcome: success
priority: normal
when: ""
derived_from: []
depends_on: []
sources: ["Codex 실측 2026-10-21 (임시 프로젝트 journal codex-456df9f59d.jsonl)"]
files: [plugins/my-default-env/hooks/run.cjs]
---
# Stop 차단이 노트 기록 명령 자체를 미기록 작업으로 셌다

## 문제 / 증상
Codex 실측에서 에이전트가 kn note를 쓴 뒤 kn index를 실행하자, 이 두 호출이 노트 이후 작업으로 집계돼 Stop이 한 번 더 막혔다. 에이전트는 "skip" 노트를 남기고 끝냈다 (불필요한 왕복).

## 가설
노트 mtime 이후의 모든 비읽기 도구 호출을 세기 때문.

## 변경
run.cjs에 isBookkeeping(): 입력에 kn.cjs 또는 .knowledge/(journal|attempts|findings|research|entities|INDEX) 경로가 있으면 제외. JSON 문자열화된 Windows 경로의 이중 역슬래시도 매치.

## 검증 (실행한 명령과 실제 결과)
- 같은 시나리오로 codex exec 재실행 → "hook: Stop Completed" 1회, 추가 block 없음.
- tests/kn.test.cjs 'bookkeeping does not count' 통과.

## 결과와 원인
해결. 원인은 가설과 같음.
