# TASK-004 Shared foundation package (@agentapp/shared)

## 1) Problem
We need a shared TS package for:
- ID types (RunId, ApprovalId, etc.)
- Event envelope types (EventEnvelopeV1)
- Reason codes / enums
- JSON schema artifacts (later: @event schema)

## 2) Scope
In scope:
- Create packages/shared exports:
  - string template types for ids
  - EventEnvelopeV1 interface (field names align with DB migration: event_type/event_version)
  - enums: ActorType, StreamType, RedactionLevel
- Add small ULID generator helper (dependency: `ulid`)

Out of scope:
- Full validation (Ajv) and full event catalog (later task)

## 3) Constraints
- Keep package dependency-light
- No runtime secrets, no environment reading in shared

## 4) Repository context
Add/modify:
- /packages/shared/src/ids.ts
- /packages/shared/src/events.ts
- /packages/shared/src/index.ts
- /packages/shared/package.json (add ulid)
- /packages/shared/tsconfig.json

## 5) Acceptance criteria
- `pnpm -C packages/shared typecheck` passes
- apps/api can import from `@agentapp/shared` without path hacks (workspace dep)

## 6) Steps
1) Add `ulid` dependency in shared
2) Implement ids.ts:
   - export types: `RunId = \`run_${string}\``, `ApprovalId = \`appr_${string}\``, etc.
   - export `newRunId(): RunId` etc (wrap ulid)
3) Implement events.ts:
   - EventEnvelopeV1 shape (event_id, event_type, event_version, occurred_at, actor, stream, data)
   - include `correlation_id` (+ optional `causation_id`) in the envelope
4) Export from index.ts

## 7) Risks
- TS template literal types can be too strict
  - Mitigation: keep them as types, validate at runtime later

## 8) Rollback
Revert shared package changes.
