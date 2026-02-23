# TASK-309: Desktop Run Profiles + `.env.desktop.example`

## 1) Problem
Desktop mode supports many env toggles, but repeated manual env input is error-prone.  
Local operators need stable run profiles and a shareable non-secret template.

## 2) Scope
In scope:
- Add root scripts for desktop embedded/external profiles.
- Add `.env.desktop.example` template with desktop/runtime fields.
- Update README with profile commands + env template usage.

Out of scope:
- Secret values.
- Installer packaging.
- Backend/API changes.

## 3) Constraints (Security/Policy/Cost)
- Never add secrets to tracked files.
- Keep existing default behavior intact (`pnpm desktop:dev`).
- No new dependencies.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/package.json`
- `/Users/min/Downloads/에이전트 앱/README.md`

New files:
- `/Users/min/Downloads/에이전트 앱/.env.desktop.example`

## 5) Acceptance criteria (observable)
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. Add `desktop:dev:embedded` and `desktop:dev:external` scripts.
2. Add `.env.desktop.example` with non-secret defaults/comments.
3. Update README usage section.
4. Run validations.

## 7) Risks & mitigations
- Risk: shell env syntax is platform-specific.
  - Mitigation: document as local macOS/dev profile convenience.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/package.json`
- `/Users/min/Downloads/에이전트 앱/README.md`
- `/Users/min/Downloads/에이전트 앱/.env.desktop.example`
