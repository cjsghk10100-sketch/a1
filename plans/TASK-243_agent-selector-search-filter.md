# TASK-243: Agent Selector Search Filter (Name/ID)

## 1) Problem
As the number of agents grows, selecting one from a long dropdown becomes slow and error-prone.

## 2) Scope
In scope:
- Add search input for agent selector on Agent Profile page.
- Filter dropdown options by display name or agent_id (case-insensitive).
- Show lightweight filtered-count hint.
- Add EN/KO i18n keys for new UI text.

Out of scope:
- Backend/API changes.
- Pagination or virtualized dropdown.

## 3) Constraints (Security/Policy/Cost)
- UI-only change; no policy/security behavior changes.
- Keep existing manual agent-id input flow intact.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-243_agent-selector-search-filter.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Agent dropdown options are filtered by search query against name/id.

## 6) Step-by-step plan
1. Add `agentFilterQuery` state and normalized filter logic.
2. Replace selector options with filtered list.
3. Add search input and filtered-count hint UI.
4. Add EN/KO i18n keys.
5. Run verification commands.

## 7) Risks & mitigations
- Risk: Selected agent may be filtered out and appear missing.
  - Mitigation: include currently selected agent in filtered options even if query mismatch.

## 8) Rollback plan
Revert this commit to restore the previous selector behavior.
