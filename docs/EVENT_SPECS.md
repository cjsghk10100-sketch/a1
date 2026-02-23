# Event Specs

This document defines the canonical contract for domain events in the Agent OS.

## Principles

- Events are append-only and immutable.
- Event types are stable and descriptive: `noun.verb` (example: `run.created`).
- Payloads are versioned; prefer additive changes.
- Consumers must tolerate unknown fields (open set).

## Event Envelope (Write Contract)

At write time, events are appended using the `EventEnvelopeV1` contract in:

- `packages/shared/src/events.ts`

Required fields:

- `event_id` (UUID)
- `event_type` (string)
- `event_version` (int)
- `occurred_at` (RFC3339 timestamp)
- `workspace_id` (string)
- `actor` (identity)
  - `actor_type`: `user | service | agent`
  - `actor_id`: string
- `stream` (ordering + fanout)
  - `stream_type`: `room | thread | workspace`
  - `stream_id`: string
- `correlation_id` (UUID/string)
- `data` (JSON payload)

Optional fields (additive):
- `mission_id`, `room_id`, `thread_id`, `run_id`, `step_id`
- `causation_id`
- `policy_context`, `model_context`, `display`
- `redaction_level`: `none | partial | full`
- `contains_secrets`: boolean
- `idempotency_key`

Planned additive fields (OS hardening; optional at first):
- `actor_principal_id` (stable principal id)
- `zone`: `sandbox | supervised | high_stakes`
- `prev_event_hash`, `event_hash` (tamper-evident hash chain)

## Persistence Fields (Read Contract)

When reading persisted events (e.g. via `/v1/events`, room SSE), the server also returns:

- `recorded_at` (DB-assigned timestamp)
- `stream_seq` (monotonic sequence per `(stream_type, stream_id)`)

`stream_seq` is the source of truth for:

- SSE resume (`from_seq`)
- per-room read cursors (notifications)

## Stream Rules

- Each event is appended to exactly one stream.
- For room-scoped operations, the **room stream** (`stream_type=room`, `stream_id=room_id`) is the primary realtime feed:
  - all room-scoped events MUST be appended to the room stream.

## Versioning Rules

- `event_version` changes only for breaking payload schema changes.
- Additive changes should keep the same `event_version`.
- Consumers must handle older versions and missing optional fields.

## Implemented Event Types (Current)

- `room.created` (v1)
- `thread.created` (v1)
- `message.created` (v1)
- `approval.requested` (v1)
- `approval.decided` (v1)
- `run.created` (v1)
- `run.started` (v1)
- `run.completed` (v1)
- `run.failed` (v1)
- `step.created` (v1)
- `tool.invoked` (v1)
- `tool.succeeded` (v1)
- `tool.failed` (v1)
- `artifact.created` (v1)
- `incident.opened` (v1)
- `incident.rca.updated` (v1)
- `incident.learning.logged` (v1)
- `incident.closed` (v1)
- `survival.ledger.rolled_up` (v1)
- `lifecycle.state.changed` (v1)
- `discord.channel.mapped` (v1)
- `discord.message.ingested` (v1)
- `engine.registered` (v1)
- `engine.token.issued` (v1)
- `engine.token.revoked` (v1)
- `engine.deactivated` (v1)

## Implemented Non-Event Runtime Contracts

Some runtime safety contracts are projection/API level (not standalone events):

- Run claim lease metadata on `proj_runs`:
  - `claim_token`
  - `claimed_by_actor_id`
  - `lease_expires_at`
  - `lease_heartbeat_at`
- Run attempt history on `run_attempts`:
  - `run_attempt_id`
  - `attempt_no`
  - `claimed_at`
  - `released_at`
  - `release_reason`
  - `engine_id`
- Lease endpoints:
  - `POST /v1/runs/:id/lease/heartbeat`
  - `POST /v1/runs/:id/lease/release`
- Engine trust-boundary endpoints:
  - `POST /v1/engines/register`
  - `POST /v1/engines/:engineId/tokens/issue`
  - `POST /v1/engines/:engineId/tokens/:tokenId/revoke`
  - `POST /v1/engines/:engineId/deactivate`

These contracts are intentionally non-event to avoid noise while preserving run ownership safety.

## Planned Event Families (vNext)

These are expected as the OS hardening + growth substrate lands. Names are stable, payloads are subject to additive iteration:

- Principals/capabilities:
  - `agent.registered` (v1)
  - `agent.quarantined` (v1)
  - `agent.unquarantined` (v1)
  - `agent.capability.granted` (v1)
  - `agent.capability.revoked` (v1)
  - `agent.delegation.attempted` (v1)
- Egress:
  - `egress.requested` (v1)
  - `egress.allowed` (v1)
  - `egress.blocked` (v1)
  - `quota.exceeded` (v1)
- Supply chain:
  - `skill.package.installed` (v1)
  - `skill.package.verified` (v1)
  - `skill.package.quarantined` (v1)
- Secrets/redaction:
  - `secret.accessed` (v1)
  - `secret.leaked.detected` (v1)
  - `event.redacted` (v1)
- Growth:
  - `agent.trust.increased` (v1)
  - `agent.trust.decreased` (v1)
  - `autonomy.upgrade.recommended` (v1)
  - `autonomy.upgrade.approved` (v1)
  - `learning.from_failure` (v1)
  - `constraint.learned` (v1)
  - `mistake.repeated` (v1)
  - `daily.agent.snapshot` (v1)
