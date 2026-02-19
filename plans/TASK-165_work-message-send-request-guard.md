# TASK-165: Work Message Send Request Guard

## Summary
Work 메시지 전송(send) 요청이 비동기로 완료될 때 thread 컨텍스트가 이미 바뀐 경우, stale 응답이 compose/상태를 덮어쓰지 않도록 요청 가드를 추가한다.

## Scope
- `apps/web/src/pages/WorkPage.tsx` send action에 request id 가드 추가
- 성공/실패/로딩 상태 및 compose clear를 현재 thread 컨텍스트에서만 반영
- room/thread 전환 시 in-flight send 요청 무효화 및 send state 리셋

## Out of Scope
- API/DB/event/projector 변경 없음
- 검색(search) 및 create 흐름 변경 없음 (이미 별도 TASK)

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- 수동 확인: send 중 thread를 바꾸면 새 thread UI가 loading에 묶이지 않고, 이전 thread 응답이 현재 compose를 지우지 않음
