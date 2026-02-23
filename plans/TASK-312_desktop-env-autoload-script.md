# TASK-312: Desktop `.env.desktop` Autoload Script

## 1) Problem
Operators currently run multiple commands to load `.env.desktop` before desktop start.  
This causes repeated mistakes and inconsistent local runs.

## 2) Scope
In scope:
- Add root script that auto-loads `.env.desktop` (if present) then starts desktop.
- Document one-command usage in README.

Out of scope:
- Cross-platform shell abstraction.
- Secret management changes.
- Desktop runtime logic changes.

## 3) Constraints (Security/Policy/Cost)
- `.env.desktop` remains untracked and local-only.
- Keep existing scripts unchanged.
- No dependencies.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/package.json`
- `/Users/min/Downloads/에이전트 앱/README.md`

## 5) Acceptance criteria (observable)
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. Add `desktop:dev:env` script.
2. Update README usage snippet.
3. Run validation commands.

## 7) Risks & mitigations
- Risk: script shell compatibility.
  - Mitigation: keep script simple POSIX-style and document local macOS usage.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/package.json`
- `/Users/min/Downloads/에이전트 앱/README.md`
