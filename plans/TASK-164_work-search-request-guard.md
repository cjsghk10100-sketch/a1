# TASK-164: Work Search Request Guard

## Summary
Work 화면 검색(Search) 요청의 비동기 응답이 늦게 돌아왔을 때, 이미 room 또는 query 컨텍스트가 바뀐 상태라면 stale 결과가 현재 화면을 덮어쓰지 않도록 요청 가드를 추가한다.

## Scope
- `apps/web/src/pages/WorkPage.tsx`의 `runSearch()`에 request id 가드 추가
- room/query 스냅샷 검증 후에만 결과/오류/상태 반영
- room 변경 시 in-flight search 요청 무효화

## Out of Scope
- API/DB/event/projector 변경 없음
- 메시지 전송(send) 가드는 후속 TASK

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- 수동 확인: 검색 중 room 또는 query를 바꿔도 이전 요청 결과가 현재 컨텍스트를 덮어쓰지 않음
