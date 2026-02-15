# TASK-104: Policy Gate v2 (unified authorize_* + shadow mode)

## Dependencies
- TASK-102 action registry (classification)
- TASK-103 capability tokens (model)
- Existing approvals/policy route must remain stable

## 1) Problem
Policy logic is currently narrow (external.write + approvals) and not structured for:
- tool calls
- data access
- actions (reversible vs irreversible)
- egress gateway

We need a single policy gate interface, but we must not break existing behavior.

## 2) Scope
In scope:
- Introduce unified policy gate API in code:
  - `authorize_tool_call()`
  - `authorize_data_access()`
  - `authorize_action()`
  - `authorize_egress()`
- Add `POLICY_ENFORCEMENT_MODE=shadow|enforce` (default `shadow`)
  - shadow: compute decision + log/record violations, do not block
  - enforce: block on deny/require_approval as appropriate (future toggle)
- Keep existing endpoint `POST /v1/policy/evaluate` stable:
  - same response format, same semantics for `external.write`
- Emit events on denied attempts / require_approval outcomes (to power growth metrics):
  - do NOT emit events for every allow (avoid noise)

Out of scope:
- Full data access control implementation (labels/lineage) beyond the authorize function skeleton.
- Egress gateway implementation (TASK-105).

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**:
  - Default is shadow mode; existing workflows remain unblocked.
  - `POST /v1/policy/evaluate` must continue working exactly as before.
- Avoid event spam: only record negative decisions by default.

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/policyGate.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/policy.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/policy_v2.ts` (if needed)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- `POST /v1/policy/evaluate` unchanged (contract test still passes)
- In shadow mode, denied/require_approval decisions append an audit event (new event type) but do not block requests.

## 6) Step-by-step plan
1. Define authorize input structs (principal + token + action + context + zone).
2. Implement authorize_* functions delegating to existing `evaluatePolicyDbV1` for `external.write` initially.
3. Add enforcement mode env and apply in authorize_* (shadow by default).
4. Add negative-decision event type(s) (e.g. `policy.denied`, `policy.requires_approval`) and append on negative outcomes in shadow.
5. Ensure existing policy contract tests remain green.

## 7) Risks & mitigations
- Risk: Shadow mode still changes behavior by writing events.
  - Mitigation: only write events on negative outcomes; keep payload small.

## 8) Rollback plan
Revert PR. If new events were written in dev DB, they are append-only and safe to keep.

