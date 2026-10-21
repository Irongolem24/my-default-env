---
title: Knowledge Index
type: index
permalink: knowledge-index
modified: 2026-10-21T11:16:20.890+09:00
bm_parse_semantics: false
---
# Knowledge Index

> 자동 생성: `node .knowledge/bin/kn.cjs index` · profile: **code** · 노트 14개 (유효 14개)
> 순서: 0 → 1에서 지금 상황에 맞는 문서를 찾고, 필요할 때만 나머지를 연다.

## 프로젝트 메모 (수동)

<!-- manual:start -->
<!-- 사람이 직접 쓰는 영역. kn index가 보존한다. 프로젝트 목표, 절대 규칙 등. -->
<!-- manual:end -->

## 0. 먼저 읽기

- **critical** [Windows의 Codex는 훅 명령을 PowerShell로 실행하므로 node -e 형식을 쓴다](findings/2026-10-21-codex-hooks-run-in-powershell-3715dd.md) — Windows에서 Codex는 훅 command를 PowerShell로, Claude Code는 Git Bash로 실행하므로 $·역슬래시·이중따옴표 없는 node -e 명령 하나로 두 셸을 모두 지원한다
- **high** [Codex는 .claude-plugin 플러그인의 hooks/hooks.json을 로드하고 PLUGIN_ROOT를 설정한다](findings/2026-10-21-codex-loads-claude-plugin-hooks-2f10dd.md) — Codex CLI 0.159.3은 .claude-plugin만 있는 플러그인의 hooks/hooks.json을 로드하고, 훅 프로세스에 PLUGIN_ROOT 환경변수를 설정한다
- **high** [결정: 외부 도구 코드는 복사하지 않고 재구현, Basic Memory는 형식 호환만](findings/2026-10-21-decision-reimplement-not-copy-22b6a1.md) — 결정: 공개 MIT 저장소이므로 외부 도구 코드는 복사하지 않고 아이디어만 재구현하며, AGPL인 Basic Memory는 노트 형식 호환만 유지한다
- **high** [Claude Code와 Codex 플러그인·훅 스펙 비교](research/2026-10-21-platform-specs-eff178.md)

## 1. 상황별 라우팅

- hooks.json의 command를 고칠 때 → [Windows의 Codex는 훅 명령을 PowerShell로 실행하므로 node -e 형식을 쓴다](findings/2026-10-21-codex-hooks-run-in-powershell-3715dd.md)
- Codex 쪽 훅 배포 방식을 바꾸려 할 때 → [Codex는 .claude-plugin 플러그인의 hooks/hooks.json을 로드하고 PLUGIN_ROOT를 설정한다](findings/2026-10-21-codex-loads-claude-plugin-hooks-2f10dd.md)
- 외부 플러그인·스킬에서 코드를 가져오려 할 때 → [결정: 외부 도구 코드는 복사하지 않고 재구현, Basic Memory는 형식 호환만](findings/2026-10-21-decision-reimplement-not-copy-22b6a1.md)
- 훅이나 플러그인 매니페스트를 고칠 때 → [Claude Code와 Codex 플러그인·훅 스펙 비교](research/2026-10-21-platform-specs-eff178.md)
- Claude Code Bash 도구로 큰 파일을 heredoc으로 쓰려 할 때 → [Bash 도구에서 긴 heredoc 파일 작성이 따옴표 오류로 실패](attempts/2026-10-21-bash-heredoc-quote-failure-f0de55.md)

## 2. 확정된 지식 (findings)

- [Windows의 Codex는 훅 명령을 PowerShell로 실행하므로 node -e 형식을 쓴다](findings/2026-10-21-codex-hooks-run-in-powershell-3715dd.md) — Windows에서 Codex는 훅 command를 PowerShell로, Claude Code는 Git Bash로 실행하므로 $·역슬래시·이중따옴표 없는 node -e 명령 하나로 두 셸을 모두 지원한다 _(high)_
- [Codex는 .claude-plugin 플러그인의 hooks/hooks.json을 로드하고 PLUGIN_ROOT를 설정한다](findings/2026-10-21-codex-loads-claude-plugin-hooks-2f10dd.md) — Codex CLI 0.159.3은 .claude-plugin만 있는 플러그인의 hooks/hooks.json을 로드하고, 훅 프로세스에 PLUGIN_ROOT 환경변수를 설정한다 _(high)_
- [결정: 외부 도구 코드는 복사하지 않고 재구현, Basic Memory는 형식 호환만](findings/2026-10-21-decision-reimplement-not-copy-22b6a1.md) — 결정: 공개 MIT 저장소이므로 외부 도구 코드는 복사하지 않고 아이디어만 재구현하며, AGPL인 Basic Memory는 노트 형식 호환만 유지한다 _(high)_
- [Codex 셸에는 CODEX_THREAD_ID가 있고 CLAUDECODE는 부모 Claude에서 상속될 수 있다](findings/2026-10-21-codex-shell-env-host-detection-df7610.md) — Codex가 실행하는 셸에는 CODEX_THREAD_ID가 설정되고, Codex를 Claude 안에서 띄우면 CLAUDECODE 등 CLAUDE_CODE_* 변수도 상속되므로 호스트 판별은 Codex 쪽 변수를 먼저 본다 _(high)_

## 3. 진행 중인 시도

- (없음)

## 4. 최근 시도

- `success` 2026-10-21 [코드 리뷰 27건 반영 (HIGH 6, MEDIUM 10, LOW 11)](attempts/2026-10-21-review-fixes-v010-a74a49.md)
- `fail` 2026-10-21 [Bash 도구에서 긴 heredoc 파일 작성이 따옴표 오류로 실패](attempts/2026-10-21-bash-heredoc-quote-failure-f0de55.md)
- `success` 2026-10-21 [Stop 차단이 노트 기록 명령 자체를 미기록 작업으로 셌다](attempts/2026-10-21-stop-counted-bookkeeping-62e4c4.md)

## 5. 주제별

- **hooks** (5): [Stop 차단이 노트 기록 명령 자체를 미기록 작업으로 셌다](attempts/2026-10-21-stop-counted-bookkeeping-62e4c4.md), [Windows의 Codex는 훅 명령을 PowerShell로 실행하므로 node -e 형식을 쓴다](findings/2026-10-21-codex-hooks-run-in-powershell-3715dd.md), [Codex는 .claude-plugin 플러그인의 hooks/hooks.json을 로드하고 PLUGIN_ROOT를 설정한다](findings/2026-10-21-codex-loads-claude-plugin-hooks-2f10dd.md), [claude-mem 구조 분석](research/2026-10-21-claude-mem-analysis-469e65.md), [Claude Code와 Codex 플러그인·훅 스펙 비교](research/2026-10-21-platform-specs-eff178.md)
- **codex** (4): [Windows의 Codex는 훅 명령을 PowerShell로 실행하므로 node -e 형식을 쓴다](findings/2026-10-21-codex-hooks-run-in-powershell-3715dd.md), [Codex는 .claude-plugin 플러그인의 hooks/hooks.json을 로드하고 PLUGIN_ROOT를 설정한다](findings/2026-10-21-codex-loads-claude-plugin-hooks-2f10dd.md), [Codex 셸에는 CODEX_THREAD_ID가 있고 CLAUDECODE는 부모 Claude에서 상속될 수 있다](findings/2026-10-21-codex-shell-env-host-detection-df7610.md), [Claude Code와 Codex 플러그인·훅 스펙 비교](research/2026-10-21-platform-specs-eff178.md)
- **windows** (2): [Bash 도구에서 긴 heredoc 파일 작성이 따옴표 오류로 실패](attempts/2026-10-21-bash-heredoc-quote-failure-f0de55.md), [Windows의 Codex는 훅 명령을 PowerShell로 실행하므로 node -e 형식을 쓴다](findings/2026-10-21-codex-hooks-run-in-powershell-3715dd.md)
- **plugin** (2): [Codex는 .claude-plugin 플러그인의 hooks/hooks.json을 로드하고 PLUGIN_ROOT를 설정한다](findings/2026-10-21-codex-loads-claude-plugin-hooks-2f10dd.md), [Claude Code와 Codex 플러그인·훅 스펙 비교](research/2026-10-21-platform-specs-eff178.md)
- **format** (2): [Basic Memory 노트 포맷과 호환 조건](research/2026-10-21-basic-memory-format-a70460.md), [Graphiti 시간 모델과 모순 처리](research/2026-10-21-graphiti-temporal-model-d54c6f.md)
- **tooling** (1): [Bash 도구에서 긴 heredoc 파일 작성이 따옴표 오류로 실패](attempts/2026-10-21-bash-heredoc-quote-failure-f0de55.md)
- **stop** (1): [Stop 차단이 노트 기록 명령 자체를 미기록 작업으로 셌다](attempts/2026-10-21-stop-counted-bookkeeping-62e4c4.md)
- **host-detection** (1): [Codex 셸에는 CODEX_THREAD_ID가 있고 CLAUDECODE는 부모 Claude에서 상속될 수 있다](findings/2026-10-21-codex-shell-env-host-detection-df7610.md)
- **license** (1): [결정: 외부 도구 코드는 복사하지 않고 재구현, Basic Memory는 형식 호환만](findings/2026-10-21-decision-reimplement-not-copy-22b6a1.md)
- **decision** (1): [결정: 외부 도구 코드는 복사하지 않고 재구현, Basic Memory는 형식 호환만](findings/2026-10-21-decision-reimplement-not-copy-22b6a1.md)
- **basic-memory** (1): [Basic Memory 노트 포맷과 호환 조건](research/2026-10-21-basic-memory-format-a70460.md)
- **beads** (1): [Beads 데이터 모델과 에이전트 연동](research/2026-10-21-beads-model-d86bac.md)
- **claude-mem** (1): [claude-mem 구조 분석](research/2026-10-21-claude-mem-analysis-469e65.md)
- **graphiti** (1): [Graphiti 시간 모델과 모순 처리](research/2026-10-21-graphiti-temporal-model-d54c6f.md)

## 6. 허브 (많이 참조됨)

- [codex](entities/codex.md) ← 3
- [windows](entities/windows.md) ← 1

## 7. 큰 문서 목차

- (없음)

## 8. 분쟁 중 (사람 확인 필요)

- (없음)

## 9. 원본 기록 상태

- 미정리 원본 파일: 1개
- 원본 위치: `journal/<날짜>/` (`*.jsonl` = 훅 자동 기록, `notes.md` = 에이전트 서술)

## 10. 이력 (대체·철회됨)

- (없음)
