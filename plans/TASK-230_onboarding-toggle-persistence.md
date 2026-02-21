# TASK-230: Persist Onboarding Auto-Flow Toggles

## 1) Problem
Onboarding auto-flow toggles reset to defaults on every reload, which is noisy for repeated local operations.

## 2) Scope
In scope:
- Persist `autoVerifyPendingOnImport` and `autoAssessVerifiedOnImport` in localStorage.
- Restore values on page load with safe defaults (`true`).

Out of scope:
- API changes
- DB/event changes
- UX copy changes

## 3) Constraints (Security/Policy/Cost)
- Keep defaults secure and explicit (`true` for both).
- Use stable storage keys under existing `agentapp.*` namespace.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-230_onboarding-toggle-persistence.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Toggle values survive page reload.

## 6) Step-by-step plan
1. Add storage keys + boolean parse helper.
2. Initialize both toggle states from localStorage.
3. Persist both toggles via `useEffect`.
4. Run typecheck.

## 7) Risks & mitigations
- Risk: malformed stored value.
  - Mitigation: fallback to default `true`.

## 8) Rollback plan
Revert the page changes and this plan file.
