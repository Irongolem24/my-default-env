---
id: att-f0de55
title: "Bash 도구에서 긴 heredoc 파일 작성이 따옴표 오류로 실패"
type: attempt
permalink: attempts/2026-10-21-bash-heredoc-quote-failure-f0de55
created: 2026-10-21T11:03:51.002+09:00
modified: 2026-10-21T11:03:51.002+09:00
tags: [tooling, windows]
outcome: fail
priority: normal
when: "Claude Code Bash 도구로 큰 파일을 heredoc으로 쓰려 할 때"
derived_from: []
depends_on: []
sources: ["journal:claude-code-session-2026-10-21 (빌드 세션, 훅 설치 전이라 원본 없음)"]
files: []
---
# Bash 도구에서 긴 heredoc 파일 작성이 따옴표 오류로 실패

## 문제 / 증상
registry.json + scripts/env.cjs를 한 번의 Bash 호출에서 heredoc 두 개로 쓰려 하자 `unexpected EOF while looking for matching ''` 로 실패, 아무 파일도 생성되지 않았다. 같은 세션의 다른 heredoc들은 성공했다.

## 가설
관찰: 실패한 호출에는 본문에 작은따옴표·백틱·`$`가 섞인 JS 코드가 있었다. 추정 원인: PreToolUse의 rtk 명령 재작성 훅이 heredoc 본문을 다시 인용하는 과정 (미확인).

## 변경
Write 도구로 파일을 직접 작성.

## 결과와 원인
우회 성공. 원인은 확인하지 않음 — 큰 파일은 Write 도구로 쓴다.
