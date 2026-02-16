# TASK-125: Data Access Control (labels + purpose hint) - DB + API + policy + events

## Dependencies
- TASK-104 policy gate v2 (authorize_data_access + shadow/enforce)
- TASK-100 principals + actor/zone envelope fields

## 1) Problem
We currently have:
- unified `authorize_data_access()` entrypoint
- trust scoring that counts `data.access.denied`

…but we do **not** implement any data access policy, nor do we emit any `data.access.*` events.
That means:
- the OS cannot express “what data can be read/written” boundaries
- growth signals (violations/mistakes) are incomplete
- future multi-agent operation is risky (agents can read across rooms/resources without explicit contracts)

## 2) Scope
In scope:
- DB:
  - `sec_resource_labels` (workspace-scoped labels + purpose tags)
- Policy:
  - extend policy evaluation for `data.read` / `data.write` actions:
    - public/internal: allow
    - restricted: allow only when bound `room_id` matches request `room_id`
    - confidential/sensitive_pii: require justification when purpose tags mismatch
- API:
  - `POST /v1/resources/labels` (upsert label + purpose tags)
  - `GET /v1/resources/labels` (list for debugging)
  - `POST /v1/data/access/requests`:
    - resolves label from DB
    - calls `authorize_data_access()` (honors shadow/enforce)
    - emits `data.access.*` events on non-allow outcomes (avoid spam)
- Events (new):
  - `data.access.denied`
  - `data.access.purpose_hint_mismatch`
  - `data.access.justified`
  - `data.access.unjustified`

Out of scope:
- Full data lineage tracking.
- Wiring all existing reads/writes to go through this gate.
- Capability token scope enforcement for data access.
- Approval integration for data access decisions.

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**:
  - No existing endpoint behavior changes.
  - Default `POLICY_ENFORCEMENT_MODE=shadow` continues to be non-blocking.
- Avoid event spam:
  - Do not emit events for “allow” except `data.access.justified` (explicitly meaningful).
- No secrets committed.

## 4) Repository context
New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/024_data_access_labels.sql`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/data_access.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/dataAccess.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/resourceLabels.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_data_access.ts`

Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/policyGate.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/index.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes
- `POST /v1/resources/labels` creates/updates a label row
- `POST /v1/data/access/requests`:
  - returns `deny` when restricted-room label mismatches request room
  - returns `require_approval` + emits `data.access.purpose_hint_mismatch` when purpose tags mismatch and no justification
  - returns `allow` + emits `data.access.justified` when purpose tags mismatch and justification is provided

## 6) Step-by-step plan
1. Add shared types for labels and request/response contracts.
2. Add migration `024_*` for `sec_resource_labels`.
3. Implement routes:
   - resource labels upsert/list
   - data access request endpoint
4. Extend `evaluatePolicyDbV1()` to interpret `data.read`/`data.write` with label + purpose hint fields.
5. Add contract test covering deny + purpose mismatch + justification allow.

## 7) Risks & mitigations
- Risk: Over-constraining early data access blocks real usage.
  - Mitigation: enforcement stays shadow by default; purpose hint is “require justification” not hard deny.

## 8) Rollback plan
Revert the PR. Tables are additive and unused unless endpoints are called.
