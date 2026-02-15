# TASK-105: Egress Gateway Skeleton (single outbound path) - DB + API + events

## Dependencies
- TASK-104 authorize_egress skeleton

## 1) Problem
Without a single outbound gateway, policy is unenforceable:
- agents/tools could bypass controls via direct network calls
- cannot apply allowlists, rate limits, DLP, approvals consistently

We need to introduce an egress substrate even before real external integrations exist.

## 2) Scope
In scope:
- DB:
  - `sec_egress_requests` table:
    - request id, principal, zone, requested domain/url, policy decision, approval linkage, timestamps
- API:
  - `POST /v1/egress/requests` to request outbound action:
    - runs `authorize_egress`
    - returns decision (`allow|deny|require_approval`) and optional `approval_id`
  - `GET /v1/egress/requests` (list, for debugging)
- Events:
  - `egress.requested`
  - `egress.allowed`
  - `egress.blocked`

Out of scope:
- Replacing all network usage in the codebase with egress (no existing tool runner yet).
- Real email/webhook integrations.

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**:
  - No existing endpoint must start requiring egress.
  - Egress is opt-in until tools are wired to it.
- No secrets committed.

## 4) Repository context
New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/014_egress_requests.sql`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/egress.ts`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/packages/shared/src/egress.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- `POST /v1/egress/requests` writes a row and emits the correct egress event based on policy decision

## 6) Step-by-step plan
1. Add shared types for egress request/decision.
2. Add migration for `sec_egress_requests`.
3. Implement route:
   - normalize domain/url
   - call `authorize_egress` (shadow/enforce aware)
   - append event(s) and insert request row
4. Add minimal contract test for allow/deny (using policy kill-switch or allowlist stub).

## 7) Risks & mitigations
- Risk: Egress policy is under-specified early.
  - Mitigation: start with a deny-by-default or require-approval default; allowlist later.

## 8) Rollback plan
Revert PR. Leave table; not used unless called.

