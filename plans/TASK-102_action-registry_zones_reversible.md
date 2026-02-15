# TASK-102: Action Registry (reversible + zone classification) - DB first

## Dependencies
- TASK-100 (zone in envelope) recommended

## 1) Problem
“Zone2 supervised autonomy” only makes sense if the OS can tell which actions are reversible vs irreversible.
We need an explicit action registry to avoid ad-hoc hardcoding scattered across routes/tools.

## 2) Scope
In scope:
- DB:
  - Create `sec_action_registry` table (authoritative action type catalog).
  - Seed minimal entries for known actions:
    - `artifact.create`, `artifact.update` (reversible, supervised)
    - `external.write` (high_stakes by default until egress policy exists)
    - `email.send`, `payment.execute` (irreversible, high_stakes)
    - `api.call.idempotent`, `api.call.mutating` (split)
- API:
  - Optional read endpoint `GET /v1/action-registry` for UI/debugging.

Out of scope:
- Enforcing action registry decisions (TASK-104).
- Creating new action-producing UI flows.

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**: adding registry must not change current behavior; enforcement is later.
- Keep schema additive, allow future fields (jsonb metadata).

## 4) Repository context
New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/012_action_registry.sql`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/actionRegistry.ts` (optional)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Migration creates table and seeds required rows
- (If endpoint implemented) `GET /v1/action-registry` returns seeded rows

## 6) Step-by-step plan
1. Add SQL migration for `sec_action_registry`:
   - `action_type` TEXT PK
   - `reversible` BOOLEAN NOT NULL
   - `zone_required` TEXT NOT NULL CHECK in `('sandbox','supervised','high_stakes')`
   - `requires_pre_approval` BOOLEAN NOT NULL DEFAULT FALSE
   - `post_review_required` BOOLEAN NOT NULL DEFAULT FALSE
   - `metadata` JSONB NOT NULL DEFAULT '{}'
   - timestamps
2. Seed minimal actions (INSERT ... ON CONFLICT DO NOTHING).
3. (Optional) Add read endpoint and register under v1 routes.
4. Typecheck + contract tests.

## 7) Risks & mitigations
- Risk: Wrong initial classification blocks future work.
  - Mitigation: no enforcement in this task; classifications can be corrected later (data change) without breaking APIs.

## 8) Rollback plan
Revert PR. If migration applied, leaving the table is harmless (unused until enforcement).

