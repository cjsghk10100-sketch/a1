# TASK-129: Daily Snapshots Use UTC Window (Timezone-Safe)

## 1) Problem
`runDailySnapshotJob()` treats `snapshot_date` as a UTC date (`YYYY-MM-DD`), but the SQL metric windows are computed via `($n::date +/- interval ...)`, which depend on the Postgres session timezone.

In non-UTC timezones (ex: Asia/Seoul), events/rows created late in the UTC day can fall outside the intended `[snapshot_date-6d, snapshot_date+1d)` window, causing incorrect daily metrics and locally failing `apps/api/test/contract_snapshots.ts`.

## 2) Scope
In scope:
- Make daily snapshot metric windows explicitly UTC by using `timestamptz` range boundaries computed from `snapshot_date` and passed into queries.

Out of scope:
- Changing what metrics are tracked or adding new metrics.
- UI changes.

## 3) Constraints (Security/Policy/Cost)
- No secrets.
- Do not change policy enforcement semantics.
- Keep runtime overhead minimal (simple range params).

## 4) Repository context
Relevant files:
- `apps/api/src/snapshots/daily.ts`
- `apps/api/test/contract_snapshots.ts`

New files:
- `plans/TASK-129_snapshots-utc-window.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- GitHub Actions `typecheck` + `contract-tests` green on PR

## 6) Step-by-step plan
1. Introduce UTC range helpers for `[snapshot_date-6d, next_day)` in `apps/api/src/snapshots/daily.ts`.
2. Update snapshot metric queries to use `occurred_at/learned_at/... >= $range_start AND < $range_end` with `timestamptz` params.
3. Run typecheck + contract tests locally.
4. Open PR and confirm CI is green.

## 7) Risks & mitigations
- Risk: Off-by-one in date math.
- Mitigation: Use `snapshot_dateT00:00:00.000Z` anchors and reuse existing `nextIsoDate()` behavior; validate via contract tests.

## 8) Rollback plan
Revert this PR to restore the previous window logic (not recommended; it reintroduces timezone-dependent behavior).

