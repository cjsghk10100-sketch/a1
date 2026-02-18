# TASK-142: Work ToolCall Controls

## 1) Problem
Work UI can create/runs and steps, but you still need curl to invoke and complete tool calls (`tool.invoked/succeeded/failed`).
That blocks local, UI-first operation and makes it harder to validate step-level behavior (status/output/error) and skill-ledger attribution.

## 2) Scope
In scope:
- Web API helpers for tool calls:
  - Create tool call for a step (`POST /v1/steps/:stepId/toolcalls`)
  - Mark tool call succeed (`POST /v1/toolcalls/:toolCallId/succeed`)
  - Mark tool call fail (`POST /v1/toolcalls/:toolCallId/fail`)
- Work page UI:
  - Select step, list tool calls for that step
  - Create tool call (tool_name/title/input JSON + optional agent_id)
  - Succeed/Fail buttons for running tool calls
- i18n strings (en/ko)

Out of scope:
- Any API/DB/event/projector changes
- Tool execution (this is control-plane only: invoke + mark result)

## 3) Constraints (Security/Policy/Cost)
- No secrets in repo; do not add `.env` (only `.env.example` if needed, but not expected here).
- Never eval user input; JSON input is parsed with `JSON.parse` only.
- Keep changes scoped to `apps/web` + this plan file.

## 4) Repository context
Existing relevant files:
- `apps/api/src/routes/v1/toolcalls.ts` (toolcall endpoints)
- `apps/web/src/api/toolcalls.ts` (listToolCalls)
- `apps/web/src/pages/WorkPage.tsx` (Work UI)
- `apps/web/src/i18n/resources.ts` (strings)

New files to add:
- (none)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- Manual smoke:
  1. Open `/work`
  2. Start a run, create a step
  3. Create a tool call for the step
  4. Mark tool call succeed/fail and confirm list updates

## 6) Step-by-step plan
1. Extend `apps/web/src/api/toolcalls.ts` with create/succeed/fail helpers.
2. Add a Tool Calls section to `apps/web/src/pages/WorkPage.tsx`:
   - step selector, list, create form, succeed/fail actions.
3. Add i18n keys in `apps/web/src/i18n/resources.ts` (en/ko).
4. Run `pnpm -r typecheck`.

## 7) Risks & mitigations
- Risk: invalid JSON input blocks tool call creation.
  - Mitigation: keep input optional; show clear error when JSON parse fails.

## 8) Rollback plan
- Revert this PR; no schema/runtime migrations involved.

