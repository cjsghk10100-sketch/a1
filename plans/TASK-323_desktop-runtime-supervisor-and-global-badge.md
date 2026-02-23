# TASK-323: Desktop Runtime Supervisor + Global Degraded Badge

## Summary
Electron 런처에서 API/Web/Engine 비정상 종료를 자동 복구하고, web 헤더에 desktop runtime 상태 배지를 표시한다.

## Scope
- `apps/desktop/src/main.cjs`에 component supervisor(재시작/backoff/fatal) 추가
- preload bridge(`desktopRuntime.getStatus/subscribe`) 추가
- web 전역 헤더 배지 + bootstrap 세부 runtime 상태 표시
- EN/KO i18n 키 추가

## Out of Scope
- API 도메인 로직 변경
- DB 스키마 변경

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
