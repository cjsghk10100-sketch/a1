# TASK-237: Onboarding Status Actions (Certify from Summary)

## 1) Problem
The onboarding summary now shows pending/unassessed counts, but users still need to rely on the import result block (or API/curl) to trigger certify/assess. This creates an operational gap for agents that already have imported skills.

## 2) Scope
In scope:
- Add a direct action in onboarding status block to run `certify-imported`.
- Show action progress/error/result in the status block.
- Refresh onboarding summary and growth views after successful action.
- Add EN/KO i18n for the new status action texts.

Out of scope:
- API changes
- DB/migration changes
- Event schema changes

## 3) Constraints (Security/Policy/Cost)
- Keep using existing secured API (`/v1/agents/:agentId/skills/certify-imported`) with operator principal context.
- No bypass of policy/approval paths.
- Cheap-by-default: action disabled when there is no pending/unassessed work.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-237_onboarding-status-certify-action.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- In `/agent-profile`, onboarding status block can trigger certify and shows summary/error.

## 6) Step-by-step plan
1. Add local state and helper to run certify action from onboarding status block.
2. Wire action button + result/error rendering in onboarding status UI.
3. Add i18n keys for button/result text.
4. Run typecheck and full API contract tests.

## 7) Risks & mitigations
- Risk: Duplicate action logic diverges from import-section flow.
  - Mitigation: Reuse existing API path and same actor/principal derivation helper.
- Risk: Unnecessary calls when nothing to process.
  - Mitigation: Disable action when pending=0 and verified_unassessed=0.

## 8) Rollback plan
Revert web UI/state/i18n changes and this plan file.
