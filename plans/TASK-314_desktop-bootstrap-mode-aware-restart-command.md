# TASK-314: Desktop Bootstrap Mode-Aware Restart Command

## 1) Problem
Bootstrap currently prints a generic restart command (`pnpm desktop:dev`) even when runtime mode is explicitly `embedded` or `external`.
This can cause mode mismatch during recovery.

## 2) Scope
In scope:
- Generate restart command using runtime mode-specific script:
  - `embedded` -> `pnpm desktop:dev:embedded`
  - `external` -> `pnpm desktop:dev:external`
- Keep port overrides in command output.
- Reflect changed command in copied runtime payload.
- Update web tests.

Out of scope:
- Desktop launcher behavior changes.
- Backend/API changes.

## 3) Constraints (Security/Policy/Cost)
- No new dependencies.
- No secret exposure in bootstrap UI.
- Keep existing health-check/retry flow unchanged.

## 4) Repository context
Targets:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.test.tsx`

## 5) Acceptance criteria
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Steps
1. Compute mode-specific restart script from runtime mode.
2. Build restart command with port env + mode-specific script.
3. Keep payload copy aligned with rendered command.
4. Update tests for new command expectation.
5. Run validation commands.

## 7) Risks & mitigations
- Risk: unexpected mode string.
  - Mitigation: default to embedded script.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.test.tsx`
