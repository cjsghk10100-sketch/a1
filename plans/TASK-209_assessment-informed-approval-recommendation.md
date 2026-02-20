# TASK-209: Assessment-informed Approval Recommendation

## 1) Problem
Approval mode recommendation currently uses trust/scope/cost/recovery/repeated-mistake signals, but ignores skill assessment regressions. That creates a gap: an agent with recent failed assessments can still receive overly permissive recommendation modes.

## 2) Scope
In scope:
- Extend `/v1/agents/:agentId/approval-recommendation` context with assessment lifecycle risk metrics.
- Add assessment-based recommendation basis code and mode downgrades in API recommendation logic.
- Add contract coverage for assessment-driven downgrades.
- Add web i18n mapping for new basis code.

Out of scope:
- DB schema changes.
- Assessment write flow changes.
- New UI screens.

## 3) Constraints (Security/Policy/Cost)
- Read-only signal usage from existing tables.
- Keep recommendation deterministic and bounded.
- Preserve existing policy gate boundaries (Request != Execute).

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/trust.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_trust.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- New files to add:
  - none

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Contract test verifies:
  - recommendation context includes assessment metrics,
  - failed assessment burst produces stricter external/internal mode and basis code.

## 6) Step-by-step plan
1. Add helper query for recent assessment metrics in trust route.
2. Extend recommendation logic input with assessment metrics.
3. Add `assessment_regression` basis code and downgrade rules.
4. Include assessment metrics in recommendation context payload.
5. Update contract test for assessment-driven risk.
6. Update web type union + i18n basis label.
7. Run typecheck and full API contract tests.

## 7) Risks & mitigations
- Risk: Over-downgrading recommendations from sparse data.
- Mitigation: Gate by minimum sample (e.g., failed burst in 7d or low pass rate with enough observations).
- Risk: Breaking existing consumers.
- Mitigation: Additive context fields and backward-compatible basis handling.

## 8) Rollback plan
Revert changes in the four modified files to restore pre-assessment recommendation behavior.
