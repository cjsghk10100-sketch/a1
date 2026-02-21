# TASK-238: Onboarding Status Distinct Verified Skill Metrics

## 1) Problem
`onboarding-status` currently reports package-level counts (`verified/pending/quarantined`) and assessed/unassessed counts, but assessed values are skill-level. With multiple verified package versions for one skill, the summary can be misleading.

## 2) Scope
In scope:
- Add distinct verified-skill metric to onboarding status response.
- Compute assessed/unassessed using distinct verified skill ids.
- Expose new metric in web onboarding status UI.
- Add contract assertions for duplicate verified package versions.

Out of scope:
- DB migrations
- Event additions
- Policy changes

## 3) Constraints (Security/Policy/Cost)
- Read-only summary endpoint only.
- Keep backward compatibility for existing fields.
- No extra heavy scans beyond indexed agent/workspace joins.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-238_onboarding-status-distinct-verified-skills.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Onboarding status displays distinct verified skill count and consistent assessed/unassessed semantics.

## 6) Step-by-step plan
1. Extend shared onboarding status type with `verified_skills`.
2. Update API aggregation query to compute distinct verified skill ids count.
3. Keep `verified` as package count; compute assessed/unassessed based on `verified_skills`.
4. Add duplicate verified package scenario to contract test.
5. Show `verified_skills` in onboarding status UI with EN/KO i18n.
6. Run typecheck + full contracts.

## 7) Risks & mitigations
- Risk: Existing UI/tests assuming old assessed semantics.
  - Mitigation: Preserve fields; clarify semantics with new explicit `verified_skills`.
- Risk: Query complexity.
  - Mitigation: Reuse existing filtered joins and DISTINCT on constrained agent/workspace set.

## 8) Rollback plan
Revert endpoint/type/UI/test changes and this plan file.
