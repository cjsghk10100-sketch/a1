# Finance Projection v0 (PR-12A)

## Endpoint
- `POST /v1/finance/projection`

## Purpose
- Projection-only finance read API for dashboard trend cards.
- No `evt_events` reads/writes, no projector mutations, no side effects.

## Request
```json
{
  "schema_version": "2.1",
  "days_back": 30,
  "include": ["top_models"]
}
```

- `schema_version` is required and validated by `assertSupportedSchemaVersion`.
- `days_back` default `30`, clamped to `[1, 365]`.
- `days_back` accepts integer number or numeric string; invalid/non-integer values are rejected.
- `include` is optional and opt-in. Supported value is only `"top_models"`.
  - Unknown include values are ignored.
  - If `include` is absent or no known include is applied, baseline response shape is unchanged.
- Requires `x-workspace-id` header.

## Data Source (Current v0)
- Table: `public.sec_survival_ledger_daily`
- Filters:
  - `workspace_id = $workspace_id`
  - `target_type = 'workspace'`
  - `target_id = $workspace_id`
  - bounded UTC date range for `days_back`
- Bucketing column: `snapshot_date`
- Metric column: `estimated_cost_units`
- Index safety:
  - `sec_survival_ledger_daily_workspace_date_idx`
  - `sec_survival_ledger_daily_target_date_idx`

## Response
- `server_time` is always live DB UTC time (`(now() AT TIME ZONE 'UTC')::text || 'Z'`), never cached.
- `top_models` is returned only when `include=["top_models"]` is applied.
  - If model dimension is unsupported in current source, response returns:
    - `top_models: []`
    - warning `top_models_unsupported`
- Returns:
  - `range` (`days_back`, `from_day_utc`, `to_day_utc`)
  - `totals` (`estimated_cost_units` string) or `null`
  - `series_daily` gap-filled to exactly `days_back` rows when source exists
  - `warnings` list
  - `meta.cached`, `meta.cache_ttl_sec`

## Degradation Behavior
- Source table missing (`42P01`):
  - `200` with `totals: null`, `series_daily: []`, warning `finance_source_not_found`.
- Metrics DB/query failure after successful live ping:
  - `200` circuit-breaker payload with warning `finance_db_error`.
- Live ping failure itself:
  - contract error `internal_error` (status from `REASON_CODE_TO_HTTP`).

## Runtime Safety
- One client per compute path.
- `BEGIN READ ONLY` + `SET LOCAL statement_timeout='2000ms'`.
- Sequential queries only.
- Cache + singleflight + bounded map (default max 1000 entries).
- Per-entry TTL:
  - success: 30s (0s in test)
  - error: 5s (0s in test)
