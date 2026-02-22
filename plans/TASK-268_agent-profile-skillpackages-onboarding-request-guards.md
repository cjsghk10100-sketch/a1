# TASK-268: Agent Profile Skill Packages and Onboarding Request Guards

## Summary
Harden `reloadSkillPackages` and `reloadOnboardingStatus` with request-order guards so stale async completions cannot overwrite newer state in Agent Profile.

## Problem
Both loaders can be triggered multiple times from imports/actions/manual refresh. Without request-order checks, older responses can arrive later and replace newer UI state.

## Scope
- Add request sequence guard for skill package reload path.
- Add request sequence guard for onboarding status reload path.
- Ensure loading/error/data state updates are applied only for the latest request.

Out of scope:
- API changes
- UI copy changes
- New mutation behavior

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
