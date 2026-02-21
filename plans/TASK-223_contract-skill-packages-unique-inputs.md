# TASK-223: Contract Skill Packages Re-run Isolation (Unique Skill IDs/Versions)

## 1) Problem
`contract_skill_packages.ts` installs fixed `skill_id`/`version` pairs.
On reruns against a reused local DB, install can fail with `409 skill_version_already_exists`.

## 2) Scope
In scope:
- Generate per-run unique `skill_id` and semver-compatible versions in the contract.
- Keep verification/quarantine/listing assertions unchanged.

Out of scope:
- API behavior changes
- Schema/migration changes
- Refactoring unrelated tests

## 3) Constraints (Security/Policy/Cost)
- Keep versions semver-like to satisfy any existing validation.
- Keep patch strictly test-only and minimal.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_skill_packages.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-223_contract-skill-packages-unique-inputs.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Full API contract run no longer fails on `skill_version_already_exists`.

## 6) Step-by-step plan
1. Add per-run suffix and numeric patch base.
2. Replace hardcoded skill ids/versions with generated variables.
3. Re-run typecheck + full contract suite.

## 7) Risks & mitigations
- Risk: generated versions break validation.
  - Mitigation: keep `1.2.N` numeric format.
- Risk: one install path still hardcoded.
  - Mitigation: grep for old constants (`web_search_v2`, `1.2.0`, etc.) after edit.

## 8) Rollback plan
Revert this plan and contract file in one commit.
