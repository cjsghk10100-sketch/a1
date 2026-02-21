# TASK-224: Contract Agents Onboarding Re-run Isolation (Unique Inventory Skills)

## 1) Problem
`contract_agents_onboarding.ts` imports fixed skill inventory ids/versions.
On reruns against a shared DB, prior package statuses can change import/review outcomes and break assertions.

## 2) Scope
In scope:
- Generate per-run suffix for imported skill ids (and versions if needed).
- Preserve onboarding assertions (verified/pending/quarantined and review flow).

Out of scope:
- API onboarding behavior changes
- Schema/migration changes

## 3) Constraints (Security/Policy/Cost)
- Keep inventory semantic roles intact:
  - one verified candidate,
  - one manifest-missing quarantined candidate,
  - one pending-signature candidate.
- Keep test changes minimal.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-224_contract-agents-onboarding-unique-skill-inputs.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Full API contracts progress past `contract_agents_onboarding` without stale package collisions.

## 6) Step-by-step plan
1. Add per-run suffix in the contract.
2. Apply suffix to inventory skill ids.
3. Re-run typecheck + full contract suite.

## 7) Risks & mitigations
- Risk: suffix breaks assertions that expect specific ids.
  - Mitigation: no assertions rely on exact skill id literal in this contract.

## 8) Rollback plan
Revert this plan and contract file in one commit.
