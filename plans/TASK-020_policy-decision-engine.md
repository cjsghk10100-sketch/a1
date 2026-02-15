# TASK-020: Policy Decision Engine (ALLOW/DENY/REQUIRE_APPROVAL + reason_code)

## 1) Problem
We need a stable, explicit contract for making “can I do X?” decisions across the system.
Without a single policy gate interface, approvals/security logic will leak into routes/tool code and become hard to audit and evolve.

## 2) Scope
In scope:
- Define shared contract types for a policy check input/output:
  - `ALLOW | DENY | REQUIRE_APPROVAL`
  - `reason_code` (string, standardized constants)
- Provide a minimal API endpoint to evaluate policy decisions (no side effects).

Out of scope:
- Approvals DB/API/projector (TASK-021)
- Kill-switch flag + enforcement (TASK-022)
- Tool execution, runs, projectors, or event-store changes

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Endpoint is pure evaluation only (no writes).
- Prefer additive contracts; avoid breaking changes.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/events.ts` (Actor types)
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/index.ts` (v1 route registry)

New files to add:
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/policy.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/policyGate.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/policy.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI passes (`pnpm -r typecheck` + existing contract tests)
- `POST /v1/policy/evaluate` returns a decision object with `decision` and `reason_code`

## 6) Step-by-step plan
1. Add shared policy contract types/constants in `packages/shared`.
2. Implement a minimal policy gate function in `apps/api` (pure function).
3. Add `POST /v1/policy/evaluate` endpoint and register in v1 routes.
4. Run typecheck, open PR, ensure CI is green.

## 7) Risks & mitigations
- Risk: Over-specifying policy input too early.
  - Mitigation: Keep input generic (`action` + free-form `context`) and allow additive expansion.

## 8) Rollback plan
Revert the PR commit. No DB migrations or data changes are introduced.
