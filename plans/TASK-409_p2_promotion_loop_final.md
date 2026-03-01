# TASK-409 PR-9 P2 Final

## Goal
- Close the scorecard/run failed automation loop with recommendation/escalation only.
- Keep SSOT in `evt_events`; no projection writes from automation.
- Preserve existing public contracts and schema version.

## Scope
- Add `apps/api/src/automation/promotionLoop.ts`.
- Hook post-commit fire-and-forget automation calls from:
  - `apps/api/src/routes/v1/scorecards.ts`
  - `apps/api/src/routes/v1/runs.ts`
- Add contract test:
  - `apps/api/test/contract_p2_promotion_loop.ts`
- Append test command in `apps/api/package.json`.

## Rules
- No new event types, no new message intents, no migrations, no deps.
- Use idempotency key column (`evt_events.idempotency_key`) for all automation emissions.
- Kill switch: `PROMOTION_LOOP_ENABLED` default enabled, `0` means no-op.
- Automation failures never rollback core writes.

## Acceptance
- `pnpm -C apps/api typecheck`
- `DATABASE_URL=... AUTH_ALLOW_LEGACY_WORKSPACE_HEADER=1 pnpm -C apps/api exec tsx test/contract_p2_promotion_loop.ts`
- `DATABASE_URL=... AUTH_ALLOW_LEGACY_WORKSPACE_HEADER=1 pnpm -C apps/api test`
