# TASK-130: Web UI for Agent Onboarding (Register + Skill Inventory Import)

## 1) Problem
Today, onboarding a new agent (or re-certifying an existing agent that already has many skills) requires `curl`:
- `POST /v1/agents` to register
- `POST /v1/agents/:agentId/skills/import` to submit the agent's skill package inventory

This blocks “OS inside the app” workflows and makes skill review at first-join/first-certification cumbersome.

## 2) Scope
In scope (web only):
- Add an onboarding card in the Agents UI:
  - Register agent by display name
  - Import skill packages (paste JSON) for the selected agent
  - Show import summary (verified/pending/quarantined)
  - Trigger refresh of skill packages list after import

Out of scope:
- Backend changes
- Skill verification implementation changes (still uses existing endpoints)
- Bulk verify/quarantine (separate task if needed)

## 3) Constraints (Security/Policy/Cost)
- Do not log secrets (pasted JSON may include signatures/hashes; treat as non-secret but avoid verbose logging).
- Keep UI safe: validate JSON shape minimally; rely on API validation for deep checks.

## 4) Repository context
Existing relevant files:
- `apps/web/src/pages/AgentProfilePage.tsx`
- `apps/web/src/api/agents.ts`
- `apps/api/src/routes/v1/agents.ts` (`/v1/agents/:agentId/skills/import`)

New files:
- `plans/TASK-130_web-agent-skill-import-ui.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- Manual smoke:
  - Register agent from UI
  - Import skill packages JSON
  - Verify the Skill packages card shows the imported packages after refresh

## 6) Step-by-step plan
1. Add API helpers in `apps/web/src/api/agents.ts`:
   - `registerAgent()`
   - `importAgentSkills()`
2. Add “Onboarding” card to `AgentProfilePage` (Permissions tab):
   - Register form
   - Import textarea + parse + submit
   - Render import summary
3. Add i18n keys (`en`/`ko`).
4. Run `pnpm -r typecheck`.

## 7) Risks & mitigations
- Risk: Users paste wrong JSON shape.
- Mitigation: Accept both `[packages...]` and `{packages:[...]}`; show clear validation error.

## 8) Rollback plan
Revert this PR; existing `curl` onboarding remains available.

