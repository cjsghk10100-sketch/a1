# TASK-131: Principals Resolver API (Legacy Actor -> principal_id)

## 1) Problem
Some flows (notably autonomy upgrade approval) require a `principal_id` to reference who granted capabilities.

We already have `sec_principals` + automatic creation via `ensurePrincipalForLegacyActor(actor_type, actor_id)` when appending events, but the web UI has no safe way to resolve the operator principal id for a legacy actor like `user:anon`.

## 2) Scope
In scope:
- Add an API endpoint that resolves (and creates if missing) a principal for a legacy actor:
  - Input: `actor_type` (`user` | `service`) and `actor_id` (string)
  - Output: `principal_id`, `principal_type`, `legacy_actor_type`, `legacy_actor_id`
- Contract test coverage.

Out of scope:
- Auth / multi-user login.
- Exposing or listing arbitrary principals.

## 3) Constraints (Security/Policy/Cost)
- Must be additive and not break existing routes.
- No secrets.
- Keep endpoint narrowly scoped to legacy actor mapping.

## 4) Repository context
New files:
- `apps/api/src/routes/v1/principals.ts`
- `apps/api/test/contract_principals.ts`
- `plans/TASK-131_principals-legacy-ensure.md`

Modified files:
- `apps/api/src/routes/v1/index.ts`
- `apps/api/package.json` (include new contract test in `pnpm -C apps/api test`)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL="postgres://min@/agentapp_contract_test_codex?host=/tmp" pnpm -C apps/api test`
- CI green on PR (`typecheck`, `contract-tests`)

## 6) Step-by-step plan
1. Implement `POST /v1/principals/legacy/ensure`.
2. Add contract test ensuring:
   - first call creates principal, second call returns same principal id
   - `actor_type=user` maps to `principal_type=user`, `service` to `service`
3. Wire route in v1 router and CI test script.

## 7) Risks & mitigations
- Risk: Endpoint becomes a generic principal factory.
  - Mitigation: only accept legacy actor types `user|service` and require non-empty `actor_id`.

## 8) Rollback plan
Revert PR. Existing principal auto-creation via event appends remains.

