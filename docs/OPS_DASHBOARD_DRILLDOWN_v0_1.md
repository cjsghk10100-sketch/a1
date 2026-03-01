# Ops Dashboard Drilldown v0.1

## Endpoint
- `GET /v1/system/health/issues`
- Auth required (same token/session path as `/v1/system/health`)
- Header: `x-workspace-id` required
- Query:
  - `kind` (required): `cron_stale | projection_lagging | projection_watermark_missing | dlq_backlog | rate_limit_flood | active_incidents`
  - `limit` (optional, default `50`, max clamp `100`)
  - `cursor` (optional, paginated kinds only)
  - `schema_version` (optional, validated if present)

## Response
```json
{
  "schema_version": "2.1",
  "server_time": "2026-03-02T10:00:00.000Z",
  "kind": "dlq_backlog",
  "applied_limit": 50,
  "truncated": true,
  "next_cursor": "<base64url>",
  "items": [
    {
      "entity_id": "msg_001",
      "updated_at": "2026-03-02T09:50:00.000Z",
      "age_sec": 600,
      "details": { "failure_count": 3 }
    }
  ]
}
```

## Kinds and Data Sources
- `dlq_backlog`: DLQ pending rows (workspace-scoped)
- `active_incidents`: open incidents (workspace-scoped)
- `rate_limit_flood`: rate limit streak/bucket signal rows (workspace-scoped)
- `projection_lagging`: lag candidates from indexed projection tables (workspace-scoped)
- `projection_watermark_missing`: expected projector watermark gap list (workspace-scoped, synthetic)
- `cron_stale`: cron watchdog freshness (global table, no workspace column)

## Pagination and Cursor
- Paginated kinds: `dlq_backlog`, `active_incidents`, `rate_limit_flood`, `projection_lagging`
- Sort: `updated_at DESC, entity_id DESC`
- Cursor JSON (base64url): `{"updated_at":"...","entity_id":"..."}`
- Non-paginated kinds: `projection_watermark_missing`, `cron_stale`
  - ignore `limit` and `cursor`
  - always `truncated=false`

## PII/Security Rules
- `details` values are restricted to `number | boolean`
- No raw payloads, stack traces, error strings, titles, descriptions
- `server_time` / `updated_at` are UTC ISO strings

## Rate Limit Guidance
- Drilldown route uses a dedicated ops-friendly limiter (workspace-scoped, generous window).
- This avoids operator lockout while inspecting `rate_limit_flood`.
