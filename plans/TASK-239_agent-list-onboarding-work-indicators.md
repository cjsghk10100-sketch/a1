# TASK-239: Agent List Onboarding Work Indicators

## 1) Problem
When many agents exist, operators must open each agent one by one to discover pending onboarding work. This slows down daily operations.

## 2) Scope
In scope:
- Show onboarding work counts in agent selector options.
- Add quick action to jump to the next agent that still needs onboarding work.
- Keep local map in sync after status refresh for selected agent.
- Add EN/KO i18n labels.

Out of scope:
- New API endpoints
- DB/event changes

## 3) Constraints (Security/Policy/Cost)
- Use existing read-only endpoint (`/v1/agents/:agentId/skills/onboarding-status`).
- Keep requests bounded and asynchronous to avoid blocking page interactions.
- No policy bypass or side effects.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-239_agent-list-onboarding-work-indicators.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Agent selector options show onboarding work count for agents with pending work.
- “Next onboarding” action selects another agent with pending work when available.

## 6) Step-by-step plan
1. Add per-agent onboarding work map state in AgentProfilePage.
2. Fetch/update map for loaded agent list and selected agent status refresh.
3. Render indicator suffix in selector options.
4. Add “next onboarding” button and selection logic.
5. Add EN/KO i18n keys and run checks.

## 7) Risks & mitigations
- Risk: Many agents cause too many requests.
  - Mitigation: Background fetch with capped parallel chunks.
- Risk: Stale counts after actions.
  - Mitigation: Update map immediately when selected agent status reloads.

## 8) Rollback plan
Revert selector indicator/button and i18n additions, then remove this plan file.
