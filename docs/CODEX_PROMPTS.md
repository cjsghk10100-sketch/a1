# Codex prompts (copy/paste)

## A) Ask Mode (planning only)
Read /AGENTS.md and /BACKLOG.md.
Pick TASK-XXX.
Create /plans/TASK-XXX.md using the /PLANS.md template.
Be self-contained: include all relevant context in the plan.
Stop after writing the plan. Do NOT edit code.

## B) Code Mode (implementation)
Implement TASK-XXX following /plans/TASK-XXX.md exactly.
Keep the PR small.
Run tests and include commands + outputs in PR description.
Do not add new deps unless required; if you do, justify in PR.
Update docs if needed.

## C) PR review (optional GitHub workflow)
After opening the PR, request:
@codex review
Focus: security regressions + policy boundaries + i18n completeness.
