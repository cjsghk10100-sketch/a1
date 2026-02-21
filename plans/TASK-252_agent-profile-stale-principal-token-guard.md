# TASK-252: Agent Profile Stale-Principal Token Guard

## Summary
`reloadTokens()`가 비동기로 완료될 때 현재 principal context가 바뀌었으면 결과를 무시해서, Capability Tokens 패널이 잘못된 principal 데이터로 덮어써지지 않게 한다.

## Scope
In scope:
- 현재 active principal_id ref 추적
- `reloadTokens()`의 success/error/finally에 stale-principal guard 적용

Out of scope:
- API/DB 변경

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
