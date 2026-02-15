# TASK-121: Skill Ledger + Skill Assessment Harness (performance layer)

## Dependencies
- TASK-106/107 supply-chain + onboarding

## 1) Problem
We need to observe “growth” in a concrete way:
- what skills an agent has
- when it learned them
- which skills are primary (used most, high reliability)
- whether a skill regressed

## 2) Scope
In scope:
- DB:
  - `sec_skill_catalog` (definitions)
  - `sec_agent_skills` (agent skill instances: level, learned_at, usage/reliability)
  - `sec_skill_assessments` (test runs + outcomes)
- Events:
  - `agent.skill.learned`
  - `agent.skill.used`
  - `agent.skill.primary_set`
  - `skill.assessment.started/passed/failed`
- Minimal harness:
  - define “assessment suites” as JSON (cases)
  - record results; no external execution required yet

Out of scope:
- Running real tool code in a sandbox.

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**: ledger is additive; existing UI unchanged.
- Use existing tool/run events for usage attribution where possible.

## 4) Repository context
New files:
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/migrations/021_skill_ledger.sql`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/src/routes/v1/skillsLedger.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Skill catalog/agent skills can be listed
- Assessment can be recorded and emits events

## 6) Step-by-step plan
1. Add migrations for catalog/agent_skills/assessments.
2. Implement list/create/update endpoints.
3. Implement attribution: when tool events occur, increment usage counters.
4. Add basic contract tests.

## 7) Risks & mitigations
- Risk: Tool usage attribution is ambiguous early.
  - Mitigation: store raw counters and allow recalculation later.

## 8) Rollback plan
Revert PR. Tables remain unused.

