# TASK-123: Daily Snapshots (growth % metrics substrate)

## Dependencies
- TASK-120 trust score
- TASK-121 skill ledger
- TASK-122 constraints

## 1) Problem
We need stable, queryable time-series metrics for “growth”:
- trust score trend
- autonomy rate
- new skills learned
- constraints learned
- repeated mistakes

Doing this on-the-fly from raw events is expensive and unstable; we need snapshots.

## 2) Scope
In scope:
- DB:
  - `sec_daily_agent_snapshots` table (one row per agent per day)
- Snapshot generator:
  - a script/endpoint to compute today’s snapshot for all agents (manual trigger initially)
- API:
  - `GET /v1/agents/:id/snapshots?days=...`
- Event:
  - `daily.agent.snapshot`

Out of scope:
- Background scheduler/cron automation (manual run first).

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**: snapshot job is additive and optional.
- Snapshot generation must be idempotent per (agent, day).

## 4) Repository context
New files:
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/migrations/023_daily_snapshots.sql`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/scripts/snapshot_daily.ts`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/src/routes/v1/snapshots.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Running snapshot script creates/updates today’s snapshot rows
- API returns snapshot rows

## 6) Step-by-step plan
1. Add migration for daily snapshots.
2. Implement snapshot generator script:
   - compute aggregates from trust/skills/constraints tables
3. Emit `daily.agent.snapshot` event on successful snapshot write.
4. Add read endpoint.

## 7) Risks & mitigations
- Risk: Snapshot schema changes frequently.
  - Mitigation: store both typed columns for key metrics + jsonb “extras”.

## 8) Rollback plan
Revert PR. Snapshot tables can remain.

