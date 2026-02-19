# TASK-166: Work Rooms Reload Request Guard

## Summary
Work 화면의 room 목록 로드(`reloadRooms`)에 최신 요청 보호를 추가해, 이전 요청 응답이 늦게 도착해도 최신 room 목록/상태를 덮어쓰지 않게 한다.

## Scope
- `apps/web/src/pages/WorkPage.tsx`에 `roomsRequestRef` 추가
- `reloadRooms`의 로딩/성공/실패 상태 업데이트를 최신 request id에만 적용

## Out of Scope
- API/DB/event/projector 변경 없음
- 다른 reload 함수 변경 없음

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- 수동 확인: 연속으로 room refresh/create를 눌러도 마지막 요청 결과만 반영됨
