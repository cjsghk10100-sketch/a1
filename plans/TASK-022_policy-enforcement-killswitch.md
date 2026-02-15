# TASK-022: Kill-Switch + Approval Enforcement (policy gate)

## 1) Problem
We have:
- a policy interface (TASK-020) and
- approvals substrate (TASK-021),
but policy evaluation does not yet consider approved approvals, so the system cannot safely progress from “REQUIRE_APPROVAL” to “ALLOW”.

We also need a kill-switch so operators can immediately block dangerous actions (e.g., external writes) even if approvals exist.

## 2) Scope
In scope:
- Policy evaluation uses DB-backed approval state:
  - Without a matching approved approval: `REQUIRE_APPROVAL`
  - With a matching approved approval (scope + TTL): `ALLOW`
- Kill-switch env flag overrides to `DENY` for external-write actions.
- Contract test proving:
  - external.write requires approval
  - after approval(decision=approve, scope=room) external.write becomes allow
  - kill-switch forces deny

Out of scope:
- Tool execution endpoints
- Runs/steps/toolcalls schema
- UI work

## 3) Constraints (Security/Policy/Cost)
- Default must be safe: no approval => not allowed.
- Missing/invalid approval scope must not grant permissions.
- Kill-switch must be simple and hard to bypass.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/policyGate.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/policy.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/approvals.ts`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/policy.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_policy_enforcement.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI is green (typecheck + contract tests)
- `POST /v1/policy/evaluate` returns:
  - `require_approval` for external.write without approval
  - `allow` after room-scoped approval is approved and matches input scope
  - `deny` when kill-switch env flag is enabled

## 6) Step-by-step plan
1. Extend shared policy contract (optional fields + reason codes).
2. Implement DB-backed policy evaluator (checks proj_approvals for matching grants).
3. Wire policy route to use the DB-backed evaluator.
4. Add contract test; include it in api test script.
5. Typecheck, open PR, ensure CI green.

## 7) Risks & mitigations
- Risk: scope matching rules are wrong.
  - Mitigation: start with only `room` scope and explicit matching, add more scopes later.

## 8) Rollback plan
Revert PR commit(s). No data migrations are required for this task.

