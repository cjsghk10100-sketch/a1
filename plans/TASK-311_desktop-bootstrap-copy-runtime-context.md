# TASK-311: Desktop Bootstrap Copy Runtime Context

## 1) Problem
When desktop bootstrap fails, operators must manually transcribe mode/ports/error code for debugging.  
This slows issue triage and causes missing details.

## 2) Scope
In scope:
- Add "copy runtime context" action in desktop bootstrap page.
- Include runtime mode/api base/api port/web port/current error code in copied text.
- Add EN/KO i18n keys for button + result message.
- Add web test coverage for copy action.

Out of scope:
- Backend API changes.
- Persistent diagnostics storage.
- External telemetry.

## 3) Constraints (Security/Policy/Cost)
- Copy payload must not include secrets.
- Keep current bootstrap flow unchanged.
- No new dependencies.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.test.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. Add clipboard helper and copy action state in bootstrap page.
2. Add copy button + success/error hint text.
3. Add i18n keys.
4. Add/adjust tests for copy behavior.
5. Run validations.

## 7) Risks & mitigations
- Risk: clipboard not supported in environment.
  - Mitigation: graceful failure message.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.test.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
