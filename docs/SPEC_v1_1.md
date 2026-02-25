# SPEC v1.1

## Summary

Agent App v1.1 is a local-first "Agent OS": a single app surface for Work/Observation/Control.
Every meaningful state transition is written as an immutable event (append-only), enabling auditability,
replay, and strong observability. Actions that can affect the outside world are routed through a policy
gate and approvals.

## Goals

- Local-first development and operation (single user first), but with OS contracts that can evolve to multi-user safely.
- Strong observability:
  - a single room feed stream ("room stream contains all room-scoped events")
  - realtime SSE timeline with resume (`from_seq`)
  - queryable event history and drilldown (inspector)
- Strong control boundaries:
  - explicit policy decisions (`allow|deny|require_approval`) with reason codes
  - approvals workflow for high-impact actions
  - kill-switch for external writes
- Durable execution units:
  - runs/steps/toolcalls/artifacts modeled as events + projections
- Growth substrate (vNext):
  - progressive trust (recommend -> approve)
  - skill ledger and assessments
  - learning from mistakes (constraints learned)
  - daily snapshots for trend dashboards

## Non-goals

- Cloud/SaaS deployment, multi-tenant auth, or enterprise compliance (SOC2/GDPR) in v1.1.
- Discord-first operations (external chat is not the primary UI).
- Fully general agent runtime / model execution engine (v1.1 focuses on OS substrate).
- Mandatory 2-person approvals for local operation.

## Architecture (High Level)

- `apps/api`: Fastify API + event store writer + projectors (Postgres)
- `apps/web`: Web UI (React) - thin consumer of backend contracts
- `apps/desktop`: Electron launcher with runtime supervisor (API/Web/Engine auto-start + health diagnostics)
- `apps/engine`: external run claim/execute loop for queued runs
- `packages/shared`: shared ids/types/contracts
- `infra`: local dev deps (e.g. Postgres via Docker Compose)

Write model:
- append events to `evt_events` (append-only)
- projectors maintain read models (`proj_*` tables)

Read model:
- UI and APIs read from projections for state, and from `evt_events` for audit timeline.

## Core Concepts

- Workspace: top-level scope (currently defaults to `ws_dev` without auth).
- Room: primary collaboration/observability scope; has a single realtime stream (SSE).
- Thread: discussion/work unit inside a room.
- Message: markdown content in a thread.
- Event: immutable envelope representing a state transition (`event_type` + `data`).
- Stream: an ordered sequence of events (`stream_type`, `stream_id`, `stream_seq`).
- Projection: query-optimized state derived from events (`proj_*`).
- Policy gate: pure decision boundary for actions (`allow|deny|require_approval`).
- Approval: request/decision record used by policy enforcement.
- Run: an execution unit (created/started/completed/failed).
- Run claim lease: lock token + heartbeat TTL used by external engines to prevent stuck ownership.
- Step: a unit of work within a run.
- Tool call: an invocation and outcome of a tool.
- Artifact: a produced output (text/json/uri) attached to a step.

OS hardening (vNext):
- Principal: stable identity (`user|agent|service`) attached to all actions/events.
- Zone: `sandbox|supervised|high_stakes` security posture for actions/events.
- Capability token: explicit scopes + delegation chain (least privilege).
- Egress gateway: single outbound path for all external communication.
- Skill supply-chain: manifest + hash pinning + quarantine.
- Secrets vault: runtime injection + redaction/DLP to prevent leakage.
- Audit integrity: tamper-evident hash chain and redaction markers.

## Data Model

Identifiers (current):
- `room_id`: `room_...` (ULID)
- `thread_id`: `th_...` (ULID)
- `message_id`: `msg_...` (ULID)
- `approval_id`: `appr_...` (ULID)
- `run_id`: `run_...` (ULID)
- `step_id`: `step_...` (ULID)
- `tool_call_id`: `tc_...` (ULID)
- `artifact_id`: `art_...` (ULID)
- `event_id`: UUID (string)

Event store tables:
- `evt_stream_heads` (sequence allocator per stream)
- `evt_events` (append-only events)

Projection tables (current):
- `proj_rooms`, `proj_threads`, `proj_messages`
- `proj_approvals`
- `proj_runs`, `proj_steps`
- `proj_tool_calls`
- `proj_artifacts`

## API

This is a local API with a stable contract for the web app to consume.
In v1.1 there is no full auth system; `x-workspace-id` is accepted by some endpoints and defaults to `ws_dev`.

Current endpoints (selected):
- Rooms/threads/messages:
  - `GET /v1/rooms`, `POST /v1/rooms`
  - `POST /v1/rooms/:roomId/threads`
  - `POST /v1/threads/:threadId/messages`, `GET /v1/threads/:threadId/messages`
- Realtime room stream:
  - `GET /v1/streams/rooms/:roomId?from_seq=...` (SSE)
- Approvals + policy:
  - `POST /v1/approvals`, `GET /v1/approvals`, `GET /v1/approvals/:id`, `POST /v1/approvals/:id/decide`
  - `POST /v1/policy/evaluate`
- Pipeline projection:
  - `GET /v1/pipeline/projection` (fixed 6-stage render snapshot for sync adapters)
- Runs:
  - `POST /v1/runs`, `GET /v1/runs`, `GET /v1/runs/:id`
  - `POST /v1/runs/claim` (external-engine safe claim of queued run)
  - `POST /v1/runs/:id/lease/heartbeat`, `POST /v1/runs/:id/lease/release`
  - `POST /v1/runs/:id/start`, `POST /v1/runs/:id/steps`, `GET /v1/runs/:id/steps`
  - `POST /v1/runs/:id/complete`, `POST /v1/runs/:id/fail`
- Incidents:
  - `POST /v1/incidents` (supports optional `idempotency_key` for dedupe-safe open)
  - `GET /v1/incidents`, `GET /v1/incidents/:id`
- Tools/artifacts:
  - `POST /v1/steps/:stepId/toolcalls`, `POST /v1/toolcalls/:id/succeed`, `POST /v1/toolcalls/:id/fail`, `GET /v1/toolcalls`
  - `POST /v1/steps/:stepId/artifacts`, `GET /v1/artifacts`, `GET /v1/artifacts/:id`
- Events query:
  - `GET /v1/events` (filters: stream_type/stream_id/from_seq, run_id, correlation_id, etc)
  - `GET /v1/events/:eventId`

## Web

Key screens (thin consumers of backend contracts):
- Timeline: room SSE stream view + reconnect/resume cursor
- Notifications: per-room read cursor (local-only) + unread fetch via events query
- Approval Inbox: list/detail + decide approve/deny/hold
- Inspector: run/correlation drilldown across runs/steps/toolcalls/artifacts/events

## Desktop

Desktop runtime (Electron) supports:

- bootstrapping API + web automatically on launch
- embedded worker mode (`DESKTOP_RUNNER_MODE=embedded`) or external engine mode (`DESKTOP_RUNNER_MODE=external`)
- startup diagnostics page (`/desktop-bootstrap`) with recovery commands
- runtime supervisor with restart backoff and fatal/degraded state visibility
- renderer bridge (`window.desktopRuntime`) for global runtime status badge

## Events

See `docs/EVENT_SPECS.md`.

## Security

Current security posture:
- External writes (`external.write`) require approval by default.
- Kill-switch (`POLICY_KILL_SWITCH_EXTERNAL_WRITE`) can force deny regardless of approvals.
- Events are append-only at the DB level (UPDATE/DELETE guarded).

OS-level hardening (vNext; additive first, then enforced):
- Principals: stable identities for `user|agent|service` attached to events.
- Zones: `sandbox|supervised|high_stakes` + reversible/irreversible action registry.
- Capability tokens: least privilege scopes + delegation chain tracking.
- Egress gateway: single outbound path with allowlists, rate limits, and DLP.
- Supply-chain verification: skill/tool manifests + hash pinning + quarantine.
- Secrets vault: runtime injection; prevent secret leakage into events/prompts/artifacts.
- Audit integrity: tamper-evident hash chain + redaction markers (no deletes).

## Observability

Core observability pillars:
- Realtime room feed via SSE (primary operational surface).
- Immutable event history with correlation/causation ids.
- Inspector: run and correlation drilldowns + event detail view.
- Notifications read cursor enables “what changed since I last looked” workflows.
- Desktop runtime status surfaces process health and restart attempts directly in UI.

Growth observability (vNext):
- Trust score trend
- Primary skills (usage + reliability)
- Constraints learned / repeated mistakes
- Daily snapshots for dashboards

## Open Questions

- How to model multi-user auth without breaking local-first workflows?
- What is the minimal “skill manifest” schema that is both practical and secure?
- How to define reversible external actions robustly (idempotency/rollback guarantees)?
