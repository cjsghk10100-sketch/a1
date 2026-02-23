# TASK-321: Router Future Flag Test Warning Cleanup

## Summary
웹 테스트에서 매번 출력되는 React Router v7 future warning을 제거해 테스트 로그를 신호 중심으로 정리한다.

## Scope
- `MemoryRouter`를 사용하는 테스트 래퍼에 future flags 적용
  - `v7_startTransition`
  - `v7_relativeSplatPath`
- 기능 로직 변경 없이 테스트 경고만 제거

## Out of Scope
- 프로덕션 라우터 설정 변경
- 테스트 시나리오 추가/삭제

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
