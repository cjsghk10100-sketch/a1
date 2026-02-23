# TASK-315: Desktop Bootstrap External Mode Restart Regression

## 1) Problem
`DesktopBootstrapPage` now builds mode-aware restart commands, but tests only cover default embedded mode.
If env handling regresses, external mode guidance can silently break.

## 2) Scope
In scope:
- Add web test that sets `VITE_DESKTOP_RUNNER_MODE=external`.
- Verify recovery section renders `pnpm desktop:dev:external`.
- Verify copied runtime payload contains the external restart command.

Out of scope:
- Runtime/launcher behavior changes.
- API changes.

## 3) Constraints
- No new dependencies.
- Keep existing test suite style.

## 4) Target files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.test.tsx`

## 5) Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Steps
1. Add env override helper in test using `import.meta.env`.
2. Add external mode assertion test (UI + clipboard payload).
3. Restore env after test.
4. Run validations.

## 7) Risks & mitigations
- Risk: env mutation leaks across tests.
  - Mitigation: snapshot original value and restore in `finally`.
