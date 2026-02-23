# TASK-318: Desktop Bootstrap External Room Fallback Regression

## Summary
외부 실행 모드에서 `VITE_DESKTOP_ENGINE_ROOM_ID`가 비어 있을 때, bootstrap 화면이 “all rooms”로 명확히 표시되고 복사 컨텍스트에는 `engine_room=*`가 들어가도록 회귀 테스트를 추가한다.

## Scope
- `apps/web/src/pages/DesktopBootstrapPage.test.tsx`에 external mode + empty room 환경 테스트 추가
- UI 라벨(`desktop.bootstrap.runtime_engine_all_rooms`) 표시 검증
- clipboard payload의 `engine_room=*` 검증

## Out of Scope
- API/desktop 런타임 로직 변경
- i18n 신규 키 추가

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
