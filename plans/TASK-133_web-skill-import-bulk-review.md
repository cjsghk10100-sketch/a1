# TASK-133: Web Skill Inventory Import Bulk Review (First-Cert)

## Dependencies
- TASK-106 skill package verify/quarantine endpoints
- TASK-107 agent skill inventory import returns `items[].skill_package_id`

## 1) Problem
Onboarding an existing agent can involve importing dozens of skill packages.
Today, reviewing them requires manually scrolling to the Skill packages list and verifying/quarantining packages one-by-one.

We want a “first certification” bulk review action immediately after import:
- verify all `pending` packages from the imported inventory
- (optional) quarantine is still handled manually for now

## 2) Scope
In scope:
- Web UI:
  - After a successful skill inventory import, show a bulk action:
    - Verify all pending packages from this import
  - Display progress + per-package failures without breaking the page
  - Refresh the Skill packages list after completion
- i18n (en/ko) for new strings

Out of scope:
- Any API/DB changes
- Automatic quarantine decisions
- “Verify all in workspace” (must be scoped to the last import result)

## 3) Constraints (Security/Policy/Cost)
- No secrets committed
- Keep actions idempotent:
  - verifying an already verified package is OK
- Avoid overloading the API:
  - run with small concurrency (or sequential) and show progress

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/skillPackages.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- In UI:
  - Register agent -> Import skill inventory -> click “Verify pending from this import”
  - Pending packages become verified (or show errors for failures)

## 6) Step-by-step plan
1. Add UI state for bulk review (running/progress/errors).
2. Compute `pendingPackageIds` from `skillImportResult.items`.
3. Add button to verify each package id, then refresh packages list.
4. Add i18n keys (en/ko).
5. Run `pnpm -r typecheck`.

## 7) Risks & mitigations
- Risk: Large imports cause long review time.
  - Mitigation: show progress and keep concurrency low.

## 8) Rollback plan
Revert PR (web-only change).

