# TASK-163: Work Create Room Request Guard

## Summary
`WorkPage`의 Room 생성 비동기 응답이 늦게 도착했을 때, 사용자가 이미 다른 room 컨텍스트로 이동한 상태라면 현재 선택을 덮어쓰지 않도록 요청 가드를 추가한다.

## Scope
- `apps/web/src/pages/WorkPage.tsx`의 create room 처리에 request id 가드 추가
- 성공/실패/로딩 상태 업데이트를 최신 요청에만 적용
- 성공 후 자동 `setRoomId(newId)`는 요청 시작 시점 컨텍스트가 유지된 경우에만 적용

## Out of Scope
- API/DB/event/projector 변경 없음
- 다른 섹션(search/send 등) 가드 변경 없음 (후속 TASK)

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- 수동 확인: create room 요청 중 room을 바꿔도 완료 응답이 현재 room 선택을 강제로 바꾸지 않음
