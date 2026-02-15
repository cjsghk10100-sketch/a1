# TASK-103: Capability Tokens + Delegation Chain (DB + minimal APIs/events)

## Dependencies
- TASK-100 principals recommended

## 1) Problem
Role-only access control does not prevent privilege escalation or provide auditable scopes.
We need token-based capabilities with explicit scopes and delegation tracking:
- delegated scope = min(parent scope, granted scope)
- max delegation depth (default 3)

We must introduce this without affecting existing flows (initially unused by policy enforcement).

## 2) Scope
In scope:
- DB:
  - `sec_capability_tokens` table:
    - token id, issued_to principal, scopes jsonb, validity, granted_by, parent_token_id
  - `sec_delegation_edges` (optional explicit chain) OR use parent_token_id only
  - Indexes for lookup by principal + validity
- Events:
  - `agent.capability.granted` (v1)
  - `agent.capability.revoked` (v1)
  - `agent.delegation.attempted` (v1) for denied delegation
- API (minimal, local-only; no auth yet):
  - `POST /v1/capabilities/grant`
  - `POST /v1/capabilities/revoke`
  - `GET /v1/capabilities?principal_id=...`

Out of scope:
- Using these tokens to gate existing endpoints (TASK-104).
- Full authN/authZ (login, sessions).

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**: capability system exists but is not required for existing API usage.
- No secrets committed.
- Scopes must be open set (allow future fields).

## 4) Repository context
New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/013_capability_tokens.sql`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/capabilities.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/capabilities.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Grant -> token row exists and emits `agent.capability.granted` (workspace stream by default)
- Revoke -> token marked revoked (or `revoked_at` set) and emits `agent.capability.revoked`

## 6) Step-by-step plan
1. Add shared types for scopes and token shape.
2. Add DB migration for `sec_capability_tokens`:
   - `token_id` TEXT PK
   - `workspace_id` TEXT NOT NULL
   - `issued_to_principal_id` TEXT NOT NULL
   - `granted_by_principal_id` TEXT NOT NULL
   - `parent_token_id` TEXT NULL
   - `scopes` JSONB NOT NULL DEFAULT '{}'
   - `valid_until` TIMESTAMPTZ NULL
   - `revoked_at` TIMESTAMPTZ NULL
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
3. Implement routes:
   - validate delegation depth <= 3
   - validate min(parent, granted) rule (simple intersection for arrays; jsonb for future)
4. Emit events for grant/revoke/denied delegation (append-only).
5. Contract test basic flow (grant/revoke).

## 7) Risks & mitigations
- Risk: Scope intersection semantics get complex.
  - Mitigation: start with explicit, simple fields (rooms/tools/domains/actions) and keep the rest in jsonb.

## 8) Rollback plan
Revert PR. Leave tables in place (unused until enforcement).

