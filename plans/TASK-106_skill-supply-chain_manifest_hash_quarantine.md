# TASK-106: Skill/Tool Supply Chain (manifest + hash + quarantine)

## Dependencies
- TASK-100 principals (agent/service identities)

## 1) Problem
If a tool/skill package is malicious, capability tokens/policy are moot.
We need a supply-chain verification substrate:
- manifest declares required permissions (tools/data/egress)
- hash pinning prevents “same version, different code”
- quarantine blocks suspicious packages

## 2) Scope
In scope:
- DB:
  - `sec_skill_packages` table:
    - `skill_id`, `version`, `hash_sha256`
    - `signature` (optional)
    - `manifest` JSONB (required)
    - `verification_status` enum: pending|verified|quarantined
    - timestamps + `verified_at` + `quarantine_reason`
- API:
  - `POST /v1/skills/packages/install` (register -> pending)
  - `POST /v1/skills/packages/:id/verify` (static verification: hash/manifest/signature if present)
  - `POST /v1/skills/packages/:id/quarantine` (manual override)
  - `GET /v1/skills/packages` (list)
- Events:
  - `skill.package.installed`
  - `skill.package.verified`
  - `skill.package.quarantined`

Out of scope:
- Dynamic analysis runner (sandbox execution) beyond hooks/placeholder.
- Actual tool execution system.

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**: no existing flow depends on skill packages yet.
- Manifests are open set but must include at least:
  - `required_tools`, `data_access`, `egress_domains`, `sandbox_required`
- No secrets committed.

## 4) Repository context
New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/015_skill_packages.sql`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/skills_supply_chain.ts`
- `/Users/min/Downloads/에ᄋᵉ전트 앱/apps/api/src/routes/v1/skillPackages.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Install -> row pending + `skill.package.installed` event
- Verify -> row verified + `skill.package.verified` event
- Quarantine -> row quarantined + `skill.package.quarantined` event

## 6) Step-by-step plan
1. Add shared contract types for skill package + manifest.
2. Add migration for `sec_skill_packages`.
3. Implement install/verify/quarantine/list routes.
4. Add minimal contract test for state transitions.

## 7) Risks & mitigations
- Risk: Signature verification is hard to standardize early.
  - Mitigation: signature optional initially; enforce later for multi-user.

## 8) Rollback plan
Revert PR. Leave table; unused unless called.

