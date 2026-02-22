# TASK-267: Agent Profile Growth Views Request Guard

## Summary
Harden `refreshAgentGrowthViews` with request-order guarding so stale async completions cannot overwrite newer trust/skills/assessments data for the same agent.

## Problem
`refreshAgentGrowthViews` is triggered by multiple actions (certify/import/assess/recommend/etc). Overlapping calls can race and older responses can overwrite newer state because only active-agent checks exist.

## Scope
- Add request sequence guard for growth view refresh path.
- Apply guard to trust/skills/assessments state updates in `refreshAgentGrowthViews`.

Out of scope:
- API changes
- UI copy changes
- Other loaders (handled by separate tasks)

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
