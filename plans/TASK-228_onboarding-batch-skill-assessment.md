# TASK-228: Agent Onboarding Batch Skill Assessment (First Verification)

## 1) Problem
Onboarding currently imports and verifies skill packages, but skill assessment is still mostly per-skill manual.
For agents with many pre-existing skills, first-time verification should support one-shot assessment so growth/trust signals start immediately.

## 2) Scope
In scope:
- Add API endpoint to batch-assess imported verified skill packages for an agent.
- Reuse existing assessment lifecycle semantics (`started` -> `passed/failed` events and counters).
- Add onboarding UI action to trigger batch assessment.
- Add EN/KO i18n keys for new onboarding controls/messages.
- Extend onboarding contract test to cover the new endpoint.

Out of scope:
- New DB migrations
- New policy model changes
- Changing existing single-skill assess endpoint contract

## 3) Constraints (Security/Policy/Cost)
- Assess only verified imported packages by default.
- Preserve append-only event behavior (`skill.assessment.*` events emitted).
- Keep operation bounded (`limit` with sane default).
- Do not bypass actor/principal metadata; keep traceability.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/skillsLedger.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-228_onboarding-batch-skill-assessment.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api exec tsx test/contract_agents_onboarding.ts` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` still passes.
- In web onboarding section, batch assessment action can be triggered and returns visible summary.

## 6) Step-by-step plan
1. Extract shared internal helper for creating assessment lifecycle records/events.
2. Add `POST /v1/agents/:agentId/skills/assess-imported`:
   - candidate set = verified imported packages for agent (latest per skill),
   - optional `only_unassessed` and `limit`,
   - auto status `passed`, trigger_reason `onboarding_import_verification`.
3. Reuse helper from existing single-skill assess endpoint.
4. Extend onboarding contract test with batch assessment assertions.
5. Add web API helper + onboarding button and summary rendering.
6. Add EN/KO i18n strings.
7. Run typecheck + targeted/full tests.

## 7) Risks & mitigations
- Risk: duplicate assessments for already-assessed skills.
  - Mitigation: default `only_unassessed=true`, include skipped count.
- Risk: large agent inventories making long requests.
  - Mitigation: enforce max limit.
- Risk: behavior drift between single and batch assessment.
  - Mitigation: use one shared assessment writer helper.

## 8) Rollback plan
Revert API route/helper, web integration, test updates, and this plan file in one commit.
