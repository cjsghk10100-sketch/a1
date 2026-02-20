# TASK-061: Survival Ledgers + Daily Rollup

## 1) Problem
We have trust/growth snapshots, but no explicit “Sustain or Sunset” ledger that tracks daily cost vs value signals.
Without this, operators cannot audit whether an agent/workspace is economically sustainable over time.

## 2) Scope
In scope:
- Add survival ledger schema for daily rollups.
- Add daily rollup job (workspace + per-agent rows).
- Emit immutable rollup events.
- Add API read endpoints for survival ledgers.
- Add contract test coverage.
- Update event docs and backlog status.

Out of scope:
- Lifecycle state transitions/automation (TASK-062).
- New web dashboard screen for survival view.

## 3) Constraints (Security/Policy/Cost)
- Event store remains append-only.
- Rollup is idempotent per `(workspace_id, target_type, target_id, snapshot_date)`.
- No secret material in rollup extras.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/snapshots/daily.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/scripts/snapshot_daily.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/snapshots.ts`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/snapshots.ts`
  - `/Users/min/Downloads/에이전트 앱/docs/EVENT_SPECS.md`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/030_survival_ledgers.sql`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/survival/daily.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/scripts/survival_rollup.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/survival.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_survival.ts`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/survival.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Contract checks:
  - Running daily rollup writes workspace + agent survival rows.
  - Re-running same date is idempotent (`written_rows = 0` on second run).
  - `GET /v1/survival/ledger` and `GET /v1/survival/ledger/:targetType/:targetId` return rows.

## 6) Step-by-step plan
1. Add shared survival types/events.
2. Add migration for survival ledger table.
3. Implement daily rollup compute/upsert/event emit logic.
4. Add rollup script entrypoint.
5. Add survival read routes and register route.
6. Add contract test and wire into test script.
7. Update docs (`EVENT_SPECS`, `BACKLOG`).

## 7) Risks & mitigations
- Risk: cost/value metrics are noisy without external billing data.
- Mitigation: expose deterministic “estimated_cost_units / value_units” and keep formulas in `extras`.
- Risk: duplicate events on rerun.
- Mitigation: emit events only when row changed (same pattern as daily snapshots).

## 8) Rollback plan
Revert migration, shared types, rollup module/script/routes, and contract test in one revert commit.
