# Codex Workflow

This file describes the expected workflow when using an AI coding agent in this repo.

## Default Loop

1. Identify the task (from `BACKLOG.md` or an existing `plans/TASK-*.md`).
2. Read relevant specs under `docs/`.
3. Update or create the plan with concrete acceptance criteria.
4. Implement the smallest end-to-end slice first.
5. Add tests or a written test plan.
6. Update docs as needed.

## Repo Hygiene

- Keep commits task-scoped.
- Prefer deterministic scripts/commands.
- Avoid committing `.DS_Store` and build artifacts.
