# TASK-122: Learning From Mistakes (constraints learned + repeated mistakes)

## Dependencies
- TASK-104 policy gate v2 (negative decisions)

## 1) Problem
We want growth to be visible as “fewer repeated mistakes”, not just more features.
When the OS denies a tool/data/egress request, we should:
- record why
- propose an alternative
- persist a constraint so the agent can avoid repeating it

## 2) Scope
In scope:
- DB:
  - `sec_constraints` table:
    - constraint id, principal/agent id, category (tool/data/egress), pattern, guidance, learned_from_event_id
  - `sec_mistake_counters` (optional) for repeated mistake detection
- Events:
  - `learning.from_failure`
  - `constraint.learned`
  - `mistake.repeated`
- Integration:
  - on policy negative outcomes, write constraint records (shadow first)

Out of scope:
- Automated prompt rewriting / agent behavior changes (consumption is later).

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**: constraints are additive; do not block existing flows.
- Constraints must not store secrets; redact any sensitive payload.

## 4) Repository context
New files:
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/migrations/022_constraints.sql`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/src/security/learningFromFailure.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Negative policy decisions produce `constraint.learned` and optionally `mistake.repeated`

## 6) Step-by-step plan
1. Add migrations for constraints.
2. Implement helper to generate a constraint payload from a denied decision.
3. Hook into policy gate negative outcomes.
4. Add contract test for repeated denial producing repeated-mistake event.

## 7) Risks & mitigations
- Risk: constraints become noisy.
  - Mitigation: de-dup by (agent, category, pattern hash) and rate-limit events.

## 8) Rollback plan
Revert PR. Constraints data is additive.

