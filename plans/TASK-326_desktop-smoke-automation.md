# TASK-326: Desktop Smoke Automation (embedded/external)

## Summary
Desktop 런처를 headless로 기동해 health/bootstrap/run 완료까지 자동 검증하는 smoke 스크립트를 추가하고 CI에 연결한다.

## Scope
- `apps/desktop/scripts/smoke.mjs` 추가
- `DESKTOP_NO_WINDOW` 기반 headless smoke 경로 검증
- embedded/external 모드 smoke 스크립트 추가
- CI(`.github/workflows/ci.yml`)에 desktop-smoke job 추가

## Out of Scope
- full UI E2E
- 설치형 앱 실행 테스트

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/desktop run smoke:embedded`
3. `pnpm -C apps/desktop run smoke:external`
4. CI desktop-smoke job 통과
