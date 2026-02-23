# TASK-316: Desktop Failure Window Recovery Command Alignment

## 1) Problem
Desktop startup failure window still suggests `pnpm desktop:dev` + `DESKTOP_RUNNER_MODE=...`.
Recent runner profiles introduced mode-specific scripts (`desktop:dev:embedded`, `desktop:dev:external`) and env autoload (`desktop:dev:env`), so guidance is stale.

## 2) Scope
In scope:
- Update failure window recovery commands to current scripts.
- Use mode-aware port-conflict command:
  - embedded -> `pnpm desktop:dev:embedded`
  - external -> `pnpm desktop:dev:external`
- Recommend env-based launch path (`pnpm desktop:dev:env`) in generic recovery block.

Out of scope:
- Runtime behavior changes.
- API/web changes.

## 3) Constraints
- No new dependencies.
- Keep failure window behavior unchanged except text content.

## 4) Target file
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`

## 5) Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Steps
1. Replace outdated recovery command strings in failure HTML.
2. Keep runner-mode specific guidance.
3. Validate full workspace.

## 7) Risks & mitigations
- Risk: command text drift again.
  - Mitigation: align wording directly with root scripts used in README.
