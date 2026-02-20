# TASK-208: Skill Assessment Lifecycle Visibility (API + Agent Profile)

## 1) Problem
Skill ledger supports assessment events (`started/passed/failed`), but operators cannot inspect per-agent assessment history in the app.
Without this, regression/re-assessment lifecycle is opaque.

## 2) Scope
In scope:
- Add API endpoint:
  - `GET /v1/agents/:agentId/skills/assessments?limit=&skill_id=&status=`
- Add contract coverage in `contract_skill_ledger.ts`.
- Add web API helper for assessment list.
- Add Agent Profile Growth section for assessment lifecycle:
  - recent assessments list
  - compact summary (passed/failed/recent regressions)

Out of scope:
- New event types.
- Changes to assessment write flow.
- DB schema changes.

## 3) Constraints (Security/Policy/Cost)
- Read-only observability additions.
- No secrets exposed in UI (render structured values only).
- Keep endpoint bounded by `limit`.

## 4) Repository context
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/skillsLedger.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_skill_ledger.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Agent with assessment activity shows rows in Growth > Assessments.
  2. Status filter semantics verified by contract test.

## 6) Step-by-step plan
1. Add assessments list route in skillsLedger with optional `skill_id/status` filters.
2. Extend contract_skill_ledger test to call new endpoint and verify rows/filters.
3. Add web API helper/types for assessments.
4. Fetch assessments in Agent Profile and render lifecycle card.
5. Add EN/KO i18n keys.
6. Run typecheck and full API contracts.

## 7) Risks & mitigations
- Risk: Overly large payload.
- Mitigation: hard limit clamp + compact list rendering.
- Risk: timezone confusion in lifecycle ordering.
- Mitigation: server-side `ORDER BY started_at DESC` and UI timestamp formatting reuse.

## 8) Rollback plan
Revert the five files above to remove assessments listing and UI card.
