# TASK-144: Work ToolCall Result Payloads

## 1) Problem
Work UI can invoke tool calls and mark them succeed/fail, but cannot provide output/error payloads.
That makes step/toolcall output always `{}` and limits local validation of Inspector/Timeline behaviors.

## 2) Scope
In scope:
- Work page:
  - Provide optional JSON payload when succeeding a tool call (output)
  - Provide optional message + JSON payload when failing a tool call (error)
- i18n strings (en/ko)

Out of scope:
- Any API/DB/event/projector changes
- Tool execution (still control-plane only)

## 3) Constraints (Security/Policy/Cost)
- Never eval user input; JSON is parsed with `JSON.parse` only.
- Keep changes scoped to `apps/web` + this plan file.

## 4) Repository context
Existing relevant files:
- `apps/api/src/routes/v1/toolcalls.ts` (accepts succeed: `{output}`, fail: `{message,error}`)
- `apps/web/src/pages/WorkPage.tsx` (toolcalls section)
- `apps/web/src/api/toolcalls.ts` (succeedToolCall/failToolCall helpers)
- `apps/web/src/i18n/resources.ts` (strings)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- Manual smoke:
  1. `/work` → run running → step created
  2. Invoke tool call
  3. Succeed with JSON output (toolcall row shows output, step output updated)
  4. Fail with message/error JSON (toolcall row shows error, step error updated)

## 6) Step-by-step plan
1. Add lightweight UI inputs for succeed/fail payloads (per selected/running toolcall).
2. Wire inputs into `succeedToolCall()` / `failToolCall()`.
3. Add i18n keys (en/ko).
4. Run `pnpm -r typecheck`.

## 7) Risks & mitigations
- Risk: invalid JSON blocks action.
  - Mitigation: show `invalid_json` error; keep payload optional.

## 8) Rollback plan
- Revert this PR; no migrations involved.

