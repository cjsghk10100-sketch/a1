# TASK-320: Desktop Bootstrap Test Cleanup Hardening

## Summary
`DesktopBootstrapPage` 테스트에서 렌더 결과가 누적되어 다중 매칭이 자주 발생하므로, 각 테스트 종료 시 DOM cleanup을 명시적으로 수행해 회귀 테스트 안정성을 높인다.

## Scope
- `apps/web/src/pages/DesktopBootstrapPage.test.tsx`에 `cleanup` 도입
- `afterEach`에서 `cleanup()` + 기존 `unstub` 유지

## Out of Scope
- 제품 코드 변경
- 다른 테스트 파일 일괄 정리

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
