# TASK-310: Desktop Bootstrap Runtime Context Visibility

## 1) Problem
When desktop startup fails, operators currently see generic health failure text only.  
Without runtime context (mode/ports/api target), diagnosing misconfigurations takes longer.

## 2) Scope
In scope:
- Pass desktop runtime metadata to web process via Vite env.
- Show runtime context card in `/desktop-bootstrap`.
- Add EN/KO i18n keys for runtime context labels.

Out of scope:
- API changes.
- New backend diagnostics endpoint.
- Installer packaging changes.

## 3) Constraints (Security/Policy/Cost)
- No secrets in UI.
- Keep existing startup flow unchanged.
- No dependency additions.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
4. Manual:
   - On `/desktop-bootstrap`, runtime context card shows mode/api target/ports.

## 6) Step-by-step plan
1. Inject runtime env vars from desktop launcher to web process.
2. Render runtime context section in bootstrap page.
3. Add EN/KO translation keys.
4. Run validation commands.

## 7) Risks & mitigations
- Risk: missing env values in non-desktop web runs.
  - Mitigation: provide safe fallbacks in page rendering.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
