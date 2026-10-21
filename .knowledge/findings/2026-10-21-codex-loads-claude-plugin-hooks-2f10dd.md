---
id: fnd-2f10dd
title: "Codex는 .claude-plugin 플러그인의 hooks/hooks.json을 로드하고 PLUGIN_ROOT를 설정한다"
type: finding
permalink: findings/2026-10-21-codex-loads-claude-plugin-hooks-2f10dd
created: 2026-10-21T11:03:50.989+09:00
modified: 2026-10-21T11:03:50.989+09:00
tags: [codex, plugin, hooks]
claim: "Codex CLI 0.159.3은 .claude-plugin만 있는 플러그인의 hooks/hooks.json을 로드하고, 훅 프로세스에 PLUGIN_ROOT 환경변수를 설정한다"
about: ["[[codex]]"]
status: active
valid_from: 2026-10-21
valid_until: ""
recorded: 2026-10-21T11:03:50.989+09:00
superseded_at: ""
superseded_by: []
supersedes: []
sources: ["격리 CODEX_HOME에 로컬 마켓 설치 후 codex exec 실측 (2026-10-21)", "[[res-eff178]]"]
confidence: high
priority: high
when: "Codex 쪽 훅 배포 방식을 바꾸려 할 때"
---
# Codex는 .claude-plugin 플러그인의 hooks/hooks.json을 로드하고 PLUGIN_ROOT를 설정한다

## 내용
별도 .codex-plugin/plugin.json이나 Codex 전용 훅 파일 없이 Claude와 같은 hooks.json 하나로 동작한다. PostToolUseFailure처럼 Codex에 없는 이벤트 키가 있어도 로드에 실패하지 않았다.

## 근거
CODEX_HOME을 임시 폴더로 바꾸고 `codex plugin marketplace add <로컬 경로>` → `codex plugin add` → `codex exec --dangerously-bypass-hook-trust`. SessionStart/UserPromptSubmit/PostToolUse/Stop/SessionEnd가 모두 journal에 기록됐다.

## 적용 방법
일반 설치에서는 trust 승인이 필요하다: 새 대화형 세션에서 /hooks.
