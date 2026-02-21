# TASK-249: Agent Selector Sticky Selected Option

## Summary
서버 검색/페이징 상태에서 현재 선택된 `agent_id`가 목록 페이지에 없으면 `<select>`에서 선택값이 사라지는 문제를 수정한다.

## Scope
In scope:
- Agent Profile selector 옵션 구성 시, 현재 선택 에이전트를 항상 옵션에 포함
- 중복 옵션 방지

Out of scope:
- API 변경
- DB 변경

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual:
  - 검색어 입력으로 목록이 바뀌어도 현재 선택 agent_id가 selector에서 유지된다.
