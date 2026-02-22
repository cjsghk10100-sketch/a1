# TASK-271: Agent Profile Tokens Request Guard

## Summary
Harden Agent Profile token loading path so stale async responses cannot overwrite newer token state.

## Problem
Token list loading can overlap across initial principal load and mutation-triggered reloads. Without request-order guard, older responses can replace fresher token data for the same principal.

## Scope
- Add token request sequence guard.
- Apply guard to principal-driven token effect and `reloadTokens`.
- Keep existing principal active checks intact.

Out of scope:
- API changes
- Token schema changes
- UI copy changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
