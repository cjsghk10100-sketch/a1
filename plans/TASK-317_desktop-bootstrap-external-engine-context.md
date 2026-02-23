# TASK-317: Desktop Bootstrap External Engine Context Visibility

## 1) Problem
In external runner mode, bootstrap currently shows only generic runtime fields (mode/api/web ports).
Operators cannot quickly confirm engine scope and cadence (`workspace_id`, `room_id`, `actor_id`, `poll_ms`, `batch_limit`) inside the UI/copy payload.

## 2) Scope
In scope:
- Pass external engine runtime env from desktop launcher to web dev process.
- Show engine context in `/desktop-bootstrap` runtime card when mode is `external`.
- Include engine context in copied runtime payload.
- Add EN/KO i18n labels.
- Extend web tests for external-mode rendering/copy payload.

Out of scope:
- Engine behavior changes.
- API/backend changes.

## 3) Constraints
- No new dependencies.
- Keep bootstrap health-check/retry behavior unchanged.
- Do not expose secrets (all values are operational config only).

## 4) Target files
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.test.tsx`

## 5) Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Steps
1. Inject engine context env vars from desktop launcher into web process.
2. Read/display vars in bootstrap page for external mode.
3. Add vars to copy payload.
4. Add i18n keys and test coverage.
5. Run validations.

## 7) Risks & mitigations
- Risk: values drift from launcher defaults.
  - Mitigation: use same defaults in launcher and page fallback.
