# TASK-270: Inspector Recent Runs Request Guard

## Summary
Harden Inspector recent-run picker loading against stale async overwrites.

## Problem
`reloadRecentRuns` has no request-order guard. Overlapping refreshes can let an older response overwrite newer list/loading state.

## Scope
- Add request token guard to `reloadRecentRuns`.
- Apply guard to data, error, and loading state updates.

Out of scope:
- API changes
- Inspector run/correlation load flow changes
- UI copy changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/InspectorPage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
