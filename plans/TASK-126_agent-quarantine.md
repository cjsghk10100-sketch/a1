# TASK-126: Agent Quarantine (manual) + Egress Block

## Dependencies
- TASK-107 agents onboarding (sec_agents)
- TASK-104 policy gate v2 (authorize_egress)
- TASK-105 egress gateway skeleton (egress.requested/allowed/blocked)

## 1) Problem
We need an OS-level safety valve when an agent behaves suspiciously or repeatedly violates policy:
- isolate the agent to a safe mode (sandbox) conceptually
- block outbound/egress while quarantined
- record an immutable audit trail (`agent.quarantined`)

Today we lack:
- any agent quarantine state
- any enforcement that prevents a quarantined agent from making egress requests

## 2) Scope
In scope:
- DB:
  - add quarantine fields to `sec_agents`:
    - `quarantined_at` (nullable)
    - `quarantine_reason` (nullable)
- API:
  - `GET /v1/agents/:agentId` (agent metadata incl. quarantine fields)
  - `POST /v1/agents/:agentId/quarantine` (idempotent)
  - `POST /v1/agents/:agentId/unquarantine` (idempotent)
- Policy enforcement:
  - deny all `authorize_egress()` calls when `principal_id` is an agent principal with `quarantined_at != null`
- Events:
  - `agent.quarantined` (on transition to quarantined)
  - `agent.unquarantined` (on transition to not quarantined)

Out of scope:
- Automatic quarantine triggers (threshold-based) from mistakes/violations.
- Forensics run creation.
- UI changes.

## 3) Constraints (Security/Policy/Cost)
- Compatibility guarantee:
  - no existing endpoint must start requiring agents to be registered
  - quarantine only applies when `principal_id` is provided (egress is opt-in until tools are wired)
- No secrets committed.

## 4) Repository context
New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/025_agent_quarantine.sql`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agent_quarantine.ts`

Existing files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/package.json`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes
- Quarantining an agent sets DB fields and emits `agent.quarantined`
- While quarantined, an egress request using that agent's `principal_id` returns `deny` with `reason_code=agent_quarantined`
- Unquarantine clears DB fields and emits `agent.unquarantined`

## 6) Step-by-step plan
1. Add migration for `sec_agents` quarantine fields.
2. Extend agents API:
   - GET agent
   - quarantine/unquarantine endpoints
3. Add quarantine override in `authorize_egress()` (fast DB lookup by principal_id).
4. Add contract test.

## 7) Risks & mitigations
- Risk: Quarantine blocks too much.
  - Mitigation: only override egress authorization for now; expand later.

## 8) Rollback plan
Revert PR. Columns are additive. Quarantine state is only used by the new checks.
