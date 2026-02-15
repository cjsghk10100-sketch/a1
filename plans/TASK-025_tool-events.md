# TASK-025: Tool events (tool.*) - contract + projections + API + tests

## 1) Problem
Timeline/Inspector needs durable tool-call boundaries (invoke/succeed/fail) tied to `run_id` + `step_id`, with stable entity ids distinct from `event_id`.
Without this, tool execution observability and auditing becomes ad-hoc and hard to query.

## 2) Scope
In scope:
- Event contracts:
  - `tool.invoked` (v1)
  - `tool.succeeded` (v1)
  - `tool.failed` (v1)
- Projection table:
  - `proj_tool_calls` (current state for each tool call)
- Projector: `tools` projector applies tool events and updates:
  - `proj_tool_calls`
  - `proj_steps` status/output/error + `last_event_id`
  - `proj_runs` `updated_at` + `last_event_id` for ordering
- API endpoints (v1):
  - `POST /v1/steps/:stepId/toolcalls` (invoke, returns `tool_call_id`)
  - `POST /v1/toolcalls/:toolCallId/succeed`
  - `POST /v1/toolcalls/:toolCallId/fail`
  - `GET /v1/toolcalls` (filters: run_id, step_id)
  - `GET /v1/toolcalls/:toolCallId`
- Contract test:
  - invoke -> succeed flow appears in room SSE
  - `tool_call_id` is stable and differs from `event_id`
  - correlation_id stable (uses run correlation)
  - causation_id chains invoked -> succeeded
  - projections updated

Out of scope:
- Actual tool execution sandboxing
- Artifacts (next task)

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Room stream remains the primary realtime stream for room-scoped runs.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/ids.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/runs.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/streams.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/008_tool_calls.sql`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/tools.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/toolProjector.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/toolcalls.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_toolcalls.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green (typecheck + contract tests)
- Tool invoke/succeed updates `proj_tool_calls` and step status

## 6) Step-by-step plan
1. Add shared tool event contracts + id type for tool_call_id.
2. Add `proj_tool_calls` migration.
3. Implement tool projector and wire routes to apply it.
4. Add toolcalls routes + contract test; include in api test script.
5. Typecheck, open PR, ensure CI green.

## 7) Risks & mitigations
- Risk: toolcall lifecycle needs additional states later.
  - Mitigation: keep projection payloads as jsonb and allow additive fields.

## 8) Rollback plan
Revert PR. If migration already applied locally, drop `proj_tool_calls` or reset DB.

