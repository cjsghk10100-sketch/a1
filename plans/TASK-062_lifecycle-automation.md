# TASK-062: Lifecycle Automation (ACTIVE -> PROBATION -> SUNSET)

## 1) Problem
Survival ledgers exist, but there is no automated lifecycle state machine.
Operators cannot see which targets are healthy, on probation, or should be sunset based on recent survival signals.

## 2) Scope
In scope:
- Add lifecycle state persistence tables.
- Add daily lifecycle automation job using survival ledger inputs.
- Emit lifecycle transition events when state changes.
- Add API read endpoints for lifecycle state + transitions.
- Add contract test for ACTIVE -> PROBATION -> SUNSET flow.
- Update docs and backlog.

Out of scope:
- Automatic disabling/kill actions tied to lifecycle state.
- Dedicated lifecycle dashboard UI.

## 3) Constraints (Security/Policy/Cost)
- Decisions are deterministic from persisted survival ledger values.
- Transition logic is reversible via future healthy rollups (no destructive action).
- Events remain append-only; transition history is auditable.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/survival/daily.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/survival.ts`
  - `/Users/min/Downloads/에이전트 앱/docs/EVENT_SPECS.md`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/031_lifecycle_automation.sql`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/lifecycle/automation.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/scripts/lifecycle_automation.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/lifecycle.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_lifecycle.ts`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/lifecycle.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Contract checks:
  - seeded survival rows trigger lifecycle transitions:
    - active -> probation
    - probation -> sunset
  - lifecycle state + transitions are queryable via API.

## 6) Step-by-step plan
1. Add shared lifecycle types/events.
2. Add DB tables for lifecycle current state + transition log.
3. Implement lifecycle automation logic + event emission.
4. Add automation script entrypoint.
5. Add lifecycle read routes and register.
6. Add contract test and include in test script.
7. Update docs (`EVENT_SPECS`, `BACKLOG`).

## 7) Risks & mitigations
- Risk: noisy day-to-day oscillation.
- Mitigation: use consecutive healthy/risky counters before major transition.
- Risk: implicit behavior hard to audit.
- Mitigation: persist recommendation, counters, and transition reasons.

## 8) Rollback plan
Revert migration, automation module/script/routes, shared lifecycle types, and contract test in one revert commit.
