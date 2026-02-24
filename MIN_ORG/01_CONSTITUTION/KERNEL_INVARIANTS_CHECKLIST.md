# KERNEL_INVARIANTS_CHECKLIST (Agent OS Kernel Contract)

This checklist defines the non-negotiable invariants for the Agent OS kernel.
Any proposal that violates an invariant MUST be marked REJECTED (no rewrite fallback).

## A) Event Store Invariants (`evt_events`)

1) Append-only
- `evt_events` MUST remain append-only (no UPDATE/DELETE).
- DB trigger `trg_evt_events_append_only` must exist and block mutations.

2) Stream ordering is the source of truth
- `(stream_type, stream_id, stream_seq)` is strictly monotonic and unique.
- Room SSE resume MUST use `from_seq` and `stream_seq`.

3) Idempotency is enforceable
- Unique index on `(stream_type, stream_id, idempotency_key)` MUST remain.
- New finalization events MUST set `idempotency_key` when applicable.

4) Envelope contract is stable
- Required envelope fields remain required (`event_id`, `event_type`, `event_version`, `occurred_at`, `workspace_id`, `actor`, `stream`, `correlation_id`, `data`).
- Additive fields are allowed; breaking changes require `event_version` bump.

5) DLP/redaction is applied at write time
- Event writes MUST go through `appendToStream()` to ensure DLP scan + redaction markers + secret detection events.

## B) Stream Rules Invariants

1) Room stream is primary operational feed
- All room-scoped events MUST append to the room stream (`stream_type=room`, `stream_id=room_id`).
- UI/Inspector MUST not rely on scraping non-room streams for room operations.

## C) Request != Execute Invariants (Policy + Approvals)

1) Policy gate boundary exists and is enforced
- Actions affecting the outside world are gated by policy: decision is `allow|deny|require_approval`.
- `external.write` MUST default to `require_approval` (unless kill-switch denies).

2) Approvals workflow is the explicit boundary
- Approvals are written as events (`approval.requested`, `approval.decided`) and projected to `proj_approvals`.
- Policy checks MUST rely on approved `proj_approvals` scope matching (workspace/room/run).

3) Kill-switch remains a hard stop
- `POLICY_KILL_SWITCH_EXTERNAL_WRITE` MUST deny regardless of approvals.

## D) Execution Trace Invariants (Runs/Steps/Toolcalls/Artifacts)

1) Durable execution units
- Runs/steps/toolcalls/artifacts remain 1st-class: events + projections.
- Projections (`proj_runs`, `proj_steps`, `proj_tool_calls`, `proj_artifacts`) are derived state; events are the truth.

2) Correlation/causation chaining is preserved
- Run lifecycle events chain `causation_id` from prior run event where applicable.
- Toolcalls/artifacts link to `run_id`/`step_id` and preserve run `correlation_id`.

## E) Security/Growth Substrate Must Stay Additive

- Principals/zones/capability tokens/egress/supply-chain/secrets/audit integrity MUST remain additive first.
- Do NOT weaken enforcement paths already present (policy enforcement, DLP, quarantine, capability revoke).

## F) REJECTED Change Patterns (Always reject)

- DB/architecture replacement (e.g., switching away from Postgres/event store).
- Replacing event sourcing with CRUD state as source of truth.
- Removing or bypassing policy gate / approvals boundary.
- Storing secrets in events/artifacts without enforced redaction.

## G) Kernel Test Coverage Mapping (minimum)

- append-only + hash chain: `apps/api/test/contract_audit_hash_chain.ts`
- policy enforcement + approvals: `apps/api/test/contract_policy_enforcement.ts`, `apps/api/test/contract_approvals.ts`
- SSE resume semantics: `apps/api/test/contract_room_sse.ts`
- run lifecycle: `apps/api/test/contract_runs.ts`, `apps/api/test/contract_run_claim.ts`
- DLP/secrets: `apps/api/test/contract_secrets.ts`
- kernel invariant smoke: `apps/api/test/contract_kernel_invariants.ts`
