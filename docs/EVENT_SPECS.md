# Event Specs

This document defines conventions for domain events.

## Principles

- Events are append-only and immutable.
- Event names are stable and descriptive: `noun.verb` (example: `run.created`).
- Payloads are versioned; prefer additive changes.

## Required Metadata

Every event MUST include:

- `event_id` (UUID)
- `event_name` (string)
- `event_version` (int)
- `occurred_at` (RFC3339 timestamp)
- `actor` (user/service identity)
- `correlation_id` (UUID/string)

## Suggested Fields

- `aggregate_type` (e.g. `run`)
- `aggregate_id`
- `causation_id`

## Initial Event List (Draft)

- `agent.created` (v1)
- `run.created` (v1)
- `run.started` (v1)
- `run.completed` (v1)
- `run.failed` (v1)
- `tool.invoked` (v1)
- `tool.succeeded` (v1)
- `tool.failed` (v1)
