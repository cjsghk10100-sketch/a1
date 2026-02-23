# TASK-306: Desktop API Port ↔ Web Proxy Sync

## 1) Problem
Desktop runtime exposes `DESKTOP_API_PORT`, but web dev proxy target is fixed to `http://localhost:3000`.  
When users change API port (to avoid collisions), web UI still calls the old port and bootstrap/pages fail.

## 2) Scope
In scope:
- Make web dev proxy target configurable via env.
- Ensure desktop launcher injects the correct API base URL into web process env.
- Update README notes for this behavior.

Out of scope:
- API endpoint changes.
- Desktop packaging.
- Production reverse-proxy work.

## 3) Constraints (Security/Policy/Cost)
- Keep request paths (`/v1`, `/health`) unchanged.
- No secret/env leakage in UI.
- No new dependencies.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/vite.config.ts`
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`
- `/Users/min/Downloads/에이전트 앱/README.md`

## 5) Acceptance criteria (observable)
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
4. Manual:
   - `DESKTOP_API_PORT=<non-3000> pnpm desktop:dev` boots and `/desktop-bootstrap` transitions successfully.

## 6) Step-by-step plan
1. Add `VITE_DEV_API_BASE_URL` support in `apps/web/vite.config.ts`.
2. Pass `VITE_DEV_API_BASE_URL=http://127.0.0.1:${apiPort}` from desktop launcher to web process.
3. Update README with auto-sync note and optional override variable.
4. Run full validation commands.

## 7) Risks & mitigations
- Risk: malformed env value breaks proxy.
  - Mitigation: fallback default remains `http://localhost:3000`.
- Risk: mismatch between desktop log and actual target.
  - Mitigation: desktop startup log includes resolved API port and mode.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/apps/web/vite.config.ts`
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`
- `/Users/min/Downloads/에이전트 앱/README.md`
