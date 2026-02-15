# PLANS.md (Codex execution plans)

## How to use
- For any non-trivial task: write a plan in /plans/TASK-xxx_*.md first (Ask mode).
- Plans must be self-contained: do NOT say “see other doc”. Copy the needed context into the plan.

## Plan template (copy for each task)

### 1) Problem
What is broken / missing? Why does it matter?

### 2) Scope
In scope:
Out of scope:

### 3) Constraints (Security/Policy/Cost)
- Request != Execute boundaries:
- Redaction rules:
- Budget caps:

### 4) Repository context
- Existing relevant files (paths):
- New files to add (paths):

### 5) Acceptance criteria (observable)
- Commands to run:
- Expected outputs:

### 6) Step-by-step plan
1. …
2. …
3. …

### 7) Risks & mitigations
- Risk:
- Mitigation:

### 8) Rollback plan
How to revert safely if this PR must be rolled back.
