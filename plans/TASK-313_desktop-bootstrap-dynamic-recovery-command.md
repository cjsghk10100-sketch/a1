# TASK-313: Desktop Bootstrap Dynamic Recovery Command

## 1) Problem
Bootstrap recovery section currently shows static commands only.  
When users run custom mode/ports, suggested restart command is not explicit, causing repeated mistakes.

## 2) Scope
In scope:
- Show dynamic restart command in bootstrap recovery section using current runtime context.
- Include recovery commands in copied runtime context payload.
- Add i18n key for restart command label.
- Add/adjust web test assertions.

Out of scope:
- Backend changes.
- Desktop launcher behavior changes.

## 3) Constraints (Security/Policy/Cost)
- No secret exposure.
- Keep current bootstrap behavior unchanged.
- No new dependencies.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.test.tsx`

## 5) Acceptance criteria (observable)
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. Compute runtime-aware restart command string in bootstrap page.
2. Render restart command in recovery section.
3. Include recovery commands in copy payload.
4. Add i18n keys and update tests.
5. Run validations.

## 7) Risks & mitigations
- Risk: malformed env values produce awkward command.
  - Mitigation: use safe fallback values already present in page.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/DesktopBootstrapPage.test.tsx`
