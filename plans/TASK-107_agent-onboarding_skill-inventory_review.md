# TASK-107: Agent Onboarding + First-Cert Skill Inventory Review

## Dependencies
- TASK-100 principals
- TASK-106 skill packages

## 1) Problem
Today we assume a single local operator and few tools.
In the future, we may onboard:
- other users
- external/third-party agents
- agents that already “have many skills”

We need an onboarding step that performs a one-time bulk review of an agent’s skill inventory and classifies packages as verified/pending/quarantined.

## 2) Scope
In scope:
- DB:
  - `sec_agents` table (agent registry) OR reuse principals with an agent metadata table:
    - `agent_id`, `principal_id`, `display_name`, `created_at`, `revoked_at`
  - `sec_agent_skill_packages` join table:
    - `agent_id`, `skill_id`, `version`, `hash_sha256`, `status`
- API:
  - `POST /v1/agents` (register agent principal + agent record)
  - `POST /v1/agents/:agentId/skills/import`:
    - accepts a list of skill packages (id/version/hash/manifest/signature?)
    - upserts into `sec_skill_packages` (pending) + links to agent
    - runs static verification where possible
    - returns summary counts: verified/pending/quarantined
- Events:
  - `agent.registered`
  - `agent.skills.imported` (summary payload)
  - plus the supply-chain events from TASK-106

Out of scope:
- Trust score changes based on onboarding (TASK-120).
- Dynamic analysis runner for skills.

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**: existing flows do not require agents to be registered.
- Import must be idempotent (same inventory can be submitted repeatedly).
- No secrets committed.

## 4) Repository context
New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/016_agents_onboarding.sql`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/packages/shared/src/agents.ts`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/src/routes/v1/agents.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Agent can be registered and receives an `agent_id`
- Skill inventory import returns summary and creates/links skill packages

## 6) Step-by-step plan
1. Add shared types for agent + skill inventory import request/response.
2. Add migration:
   - agent registry table
   - join table linking agent to packages
3. Implement routes:
   - register agent -> create agent principal (type=agent) and agent row
   - import inventory -> upsert packages + link + verify where possible
4. Add contract test:
   - import 3 packages (one valid, one missing manifest -> quarantined, one pending)
   - assert summary counts

## 7) Risks & mitigations
- Risk: Defining “valid manifest” too strictly too early.
  - Mitigation: start with required minimal keys; keep unknown keys allowed.

## 8) Rollback plan
Revert PR. Leave tables; unused unless onboarding is used.

