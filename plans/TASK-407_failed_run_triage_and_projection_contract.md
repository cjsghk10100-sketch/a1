# TASK-407: Pipeline Projection Contract Lock + Failed Run Triage (v0.1)


-
## Hole Mapping (Explicit Design Closure)

This section documents how the previously identified architectural holes are resolved in this task.

### Hole 1 — Failed Run Stage Ambiguity

Problem:
- If all failed runs are sent to 4_review_evidence by default, human review becomes a bottleneck.
- If all failed runs are auto-demoted, meaningful failure analysis is lost.

Resolution (v0.1 Contract):
- Default rule:
  run.status == "failed" → stage = 6_demoted
- Exception rule (review-worthy failures):
  run.status == "failed" AND (
    open incident exists for run
    OR error.code indicates policy/permission boundary violation
  ) → stage = 4_review_evidence

Rationale:
- Preserve autonomy by default.
- Escalate only when boundary/safety/systemic issue is detected.
- Avoid pipeline-wide human bottlenecks.

---

### Hole 2 — Projection Pagination & Hash Churn

Problem:
- Pagination causes partial snapshots.
- Partial snapshots cause hash churn and unstable folder rendering.
- 422-style hard failure freezes the projection (zombie folder risk).

Resolution (v0.1 Contract):
- No pagination in v0.1.
- Server fetches limit+1 and truncates to latest `limit` items.
- Always returns 200 OK.
- Response includes:
  stage_stats[stage].truncated = true if overflow occurred.

Rationale:
- Projection must never freeze.
- Folder is a mirror; mirrors must always reflect *something*, never error out.
- Stable snapshot > complete snapshot for v0.1.

---

### Hole 3 — Cron → Adapter State Timing

Problem:
- Cron may demote/promote before adapter poll interval.
- Folder may temporarily show outdated stage.

Resolution (v0.1 Strategy):
- Keep polling model (eventual consistency accepted).
- Include:
  - generated_at
  - watermark_event_id
in projection response.
- Adapter writes these into `.projection_manifest.json`.

Rationale:
- Do not reintroduce push/SSE complexity in v0.1.
- Make staleness observable instead of trying to eliminate physics.
- Visibility > premature real-time guarantees.

---

Conclusion:
Holes 1, 2, and 3 are explicitly resolved by deterministic backend stage rules,
stable snapshot contract, and explicit watermarking.
No additional adapter logic is required to enforce these guarantees.



## 0) Context (Why this exists)
We have Pipeline Sync Adapter v0.1 (Render-only). SSOT is the app event store/projections, and folders are projection-only.
To make the adapter stable (no churn, no drift, no “zombie folder”), the app must:
1) Serve a stable, single snapshot projection endpoint.
2) Decide how to place failed runs in stages (default demote, review only when meaningful).

This task is kernel-preserving: no rewrite, no DB swap, no bypass of appendToStream.



## 1) Goals
### Goal A — Contract Lock: `GET /v1/pipeline/projection`
- Always returns **6 fixed stage keys**.
- Uses **stable sorting** per stage.
- Excludes “high-churn fields” (lease/heartbeat/claim).
- No pagination in v0.1.
- If more than limit exists, server must **truncate** to most recent items and return `truncated=true` (never 422).

### Goal B — Failed Run Triage: stage rule is deterministic
- Base rule: `run.failed` → **6_demoted**
- Exception rule: failed runs are shown in **4_review_evidence** only when they are “review-worthy incidents”.

### Goal C — Backend responsibility for minimum evidence on failure (synchronous)
- Minimum failure evidence (error object/message) is produced by backend state transition logic, not the adapter.
- For API-triggered `run.failed`, if body has neither `message` nor `error`, server must still store a minimal error object (or reject as 400).

---

## 2) Non-Goals
- No evidence manifest / scorecard / lesson wiring in this task (those are v0.2+).
- No SSE push / invalidate endpoint (polling eventual consistency is acceptable in v0.1).
- No SLA demote logic in adapter (Cron/job belongs to app later).

---

## 3) Invariants (must not break)
- evt_events remains append-only and all writes go through appendToStream().
- proj_* tables remain derived read models.
- Policy gate + approvals boundary remains intact.
- Adapter is view-only; state transitions happen in app.

---

## 4) API Contract: `GET /v1/pipeline/projection` (v0.1)
### Request
- GET /v1/pipeline/projection?limit=500 (default 500, max 500)
- Headers:
  - x-workspace-id: <workspace_id>

### Response
Top-level must always include:
- meta:
  - schema_version: "pipeline_projection.v0.1"
  - generated_at: ISO string
  - limit: number
  - stage_stats: { <stage>: { returned: number, truncated: boolean } }
  - watermark_event_id: string | null (see note)
- stages: always present keys:
  - 1_inbox
  - 2_pending_approval
  - 3_execute_workspace
  - 4_review_evidence
  - 5_promoted
  - 6_demoted

**Truncation rule (no pagination):**
- Server fetches `limit + 1` rows per stage.
- If more than limit exists, drop the extra and set `stage_stats[stage].truncated=true`.
- Always respond 200 OK with truncated lists (never error-only behavior that freezes folders).

**Sorting rule (stable):**
- ORDER BY updated_at DESC, entity_id ASC

**Watermark rule (v0.1):**
- watermark_event_id = last_event_id of the most recently updated item across all returned lists (or null).
- Do NOT query evt_events for watermark in v0.1 (no workspace index).

### Item shape (minimal + stable)
For approvals:
- entity_type: "approval"
- entity_id: approval_id
- title, status(pending|held)
- updated_at, correlation_id, last_event_id
- room_id/thread_id
- links: { approval_id, run_id, incident_id(null), ... }

For runs:
- entity_type: "run"
- entity_id: run_id
- title, status(queued|running|succeeded|failed)
- updated_at, correlation_id, last_event_id
- room_id/thread_id
- links: { run_id, incident_id(optional), ... }

**Forbidden fields (churn):**
- lease_heartbeat_at, lease_expires_at, claim_token, claim executor fields

---

## 5) Stage Mapping Rules (v0.1)
### 3_execute_workspace
- runs status IN ('queued','running')

### 2_pending_approval
- approvals status IN ('pending','held')

### Failed Run Triage (핵심)
- Default: failed → 6_demoted
- Review-worthy exception: failed → 4_review_evidence iff any:
  1) There is an OPEN incident for this run (match by run_id OR correlation_id), OR
  2) proj_runs.error indicates policy/permission boundary failure
     - error->>'code' IN ('policy_denied','approval_required','permission_denied','external_write_kill_switch')
     - OR error->>'kind' == 'policy' (if you have that field)
  (Optional for later) repeated failure counters threshold exceeded.

### 4_review_evidence
- All succeeded runs (for now, until evidence/scorecard exists)
- + review-worthy failed runs (as above)

### 1_inbox / 5_promoted / 6_demoted
- v0.1:
  - 1_inbox: []
  - 5_promoted: []
  - 6_demoted: includes failed runs that are NOT review-worthy

---

## 6) Implementation Plan (files)
### A) Add/Update pipeline route
- Add: apps/api/src/routes/v1/pipeline.ts
  - registerPipelineRoutes(app, pool)
  - GET /v1/pipeline/projection
- Modify: apps/api/src/routes/v1/index.ts
  - registerPipelineRoutes()

SQL strategy (per stage):
- Use `limit+1` fetch pattern for truncation.
- Use stable ORDER BY.
- For failed triage:
  - LEFT JOIN/EXISTS against proj_incidents where status='open' and (run_id match OR correlation_id match)
  - policy error detection from proj_runs.error JSONB

### B) Minimum evidence on run.failed (API)
- Modify: apps/api/src/routes/v1/runs.ts (run.failed endpoint)
  - If req.body.error is null/undefined AND req.body.message is empty:
    - either return 400 missing_error
    - OR inject error={message:"run_failed"} synchronously before appendToStream
  - (Pick one, but must not allow silent empty error by default.)

---

## 7) Tests (contract)
### contract_pipeline_projection.ts
Assertions:
- 6 stage keys always present
- stage arrays sorted by updated_at desc + id asc
- no churn fields present (lease/heartbeat/claim)
- truncation: create >limit rows, verify `truncated=true` and returned==limit

### contract_failed_run_triage.ts (or extend projection contract)
- Create:
  - failed run with no incident + non-policy error → must appear in 6_demoted
  - failed run with open incident → must appear in 4_review_evidence
  - failed run with policy error code → must appear in 4_review_evidence

---

## 8) DoD (Definition of Done)
- pnpm -C apps/api test is green
- Projection API matches contract (including truncation meta)
- Failed triage rules are documented in the code comments + tests
- No kernel invariant violations; no new write paths outside appendToStream

---

## 9) PR Breakdown (2 PRs)
PR-1: Contract Lock (projection endpoint)
- pipeline.ts + index.ts + contract_pipeline_projection test

PR-2: Failed Run Triage + min evidence on run.failed
- projection triage logic + run.failed input validation + tests