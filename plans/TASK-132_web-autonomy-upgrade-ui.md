# TASK-132: Web Autonomy Upgrade UI (Recommend -> Approve)

## Dependencies
- TASK-120 (API: trust + autonomy recommend/approve)
- TASK-131 (API: legacy actor -> principal_id resolver)

## 1) Problem
We have a backend autonomy upgrade flow (`recommend -> approve`) but the web app has no UI to operate it.
Also, approval requires `granted_by_principal_id`, which the web UI cannot reliably produce without a resolver.

## 2) Scope
In scope:
- Web UI (Agent Profile, Permissions tab):
  - operator identity input (`user:anon` by default)
  - button: recommend autonomy upgrade
  - button: approve autonomy upgrade (requires recommendation id)
  - show recommendation + result summary (with Advanced JSON)
- Web API helpers:
  - ensure principal for legacy actor (`POST /v1/principals/legacy/ensure`)
  - recommend autonomy upgrade (`POST /v1/agents/:id/autonomy/recommend`)
  - approve autonomy upgrade (`POST /v1/agents/:id/autonomy/approve`)
- i18n (en/ko) for new strings.

Out of scope:
- Any API/DB changes (already implemented in TASK-120/131).
- Listing historical recommendations (no new read endpoint).
- Multi-user authentication.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- UI must be safe to click repeatedly:
  - `recommend` is idempotent for pending recommendations
  - `approve` is idempotent when already approved
- Default operator is local single-user (`user:anon`), but UI must allow changing the actor id.

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files (optional):
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/principals.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- UI flow works against local API:
  - Agent Profile -> Permissions tab -> Autonomy Upgrade card
  - Click Recommend -> shows `recommendation_id` and scope delta
  - Click Approve -> returns `token_id` and capability list refresh shows new token
- CI green on PR (`typecheck`, `contract-tests`)

## 6) Step-by-step plan
1. Add web API helpers for:
   - legacy principal ensure
   - autonomy recommend/approve
2. Add an "Autonomy Upgrade" section in Agent Profile (Permissions tab).
3. Wire recommend/approve buttons:
   - ensure operator principal id first
   - recommend sets local recommendation state + refreshes trust state from response
   - approve uses recommendation id + refreshes capability tokens list
4. Add i18n keys (en/ko).
5. Run `pnpm -r typecheck`.

## 7) Risks & mitigations
- Risk: Users lose recommendation id on refresh.
  - Mitigation: allow manual paste/edit of recommendation id and re-run Recommend.
- Risk: Old DBs missing endpoints/migrations return 404.
  - Mitigation: show “not available” error code; keep rest of page functional.

## 8) Rollback plan
Revert PR (web-only changes). No DB changes.

