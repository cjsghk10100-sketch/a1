# TASK-247: Agent List Stale Request Guard

## Summary
Agent 목록에서 `refresh`와 `load more`가 겹칠 때 늦게 완료된 응답이 최신 상태를 덮어쓰지 않도록 요청 시퀀스 가드를 추가한다.

## Scope
In scope:
- AgentProfilePage의 agent 목록 로딩 경로에 stale response guard 적용
- 초기 로드 / refresh / load more 모두 동일 가드 적용

Out of scope:
- API 변경
- 다른 페이지 변경

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual:
  - `Refresh` 직후 `Load more` 연속 클릭 시 마지막 요청 결과만 반영
  - 이전 cursor 기반 응답이 나중에 도착해도 목록이 꼬이지 않음
