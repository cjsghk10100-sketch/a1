# TASK-250: Agents Pagination Query/Cursor Guard

## Summary
에이전트 목록 검색(`q`)과 커서 페이지네이션(`next_cursor`)이 섞이지 않도록, 커서가 어떤 질의에서 발급됐는지 추적하고 질의 변경 시 기존 `Load more`를 즉시 무효화한다.

## Scope
In scope:
- Agent Profile의 목록 로딩 상태에 `cursor query key` 추적 추가
- 검색어 변경 시 기존 커서/hasMore 즉시 초기화
- `Load more` 요청은 “현재 query == 커서 query”일 때만 허용

Out of scope:
- API 변경
- DB 변경

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual:
  - 검색어를 바꾼 직후 `Load more`가 이전 query 커서로 동작하지 않는다.
  - 새 query 응답 후에만 `Load more`가 다시 활성화된다.
