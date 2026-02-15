# TASK-124: Web Agent Profile (Permissions + Growth UI)

## Dependencies
- TASK-120/121/122/123 APIs available

## 1) Problem
We need a human-facing “agent state” screen:
- permissions visualization (zone ring, capability matrix, delegation chain)
- growth visualization (trust trend, skills, constraints learned, repeated mistakes)

This is required to operate the OS safely as autonomy increases.

## 2) Scope
In scope:
- Web:
  - Add `Agent Profile` page with tabs:
    - Permissions
    - Growth
  - UI is summary-first; raw JSON is behind “Advanced”.
- API consumption:
  - fetch trust, capabilities, skill ledger, constraints, daily snapshots
- i18n for all strings (en/ko).

Out of scope:
- Complex dashboards for multiple agents (start single agent focus).
- Editing policies from UI (read-only first).

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**: additive web page only; existing pages unchanged.
- Conservative redaction when rendering JSON.

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/web/src/App.tsx`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/web/src/i18n/resources.ts`

New files (likely):
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/web/src/api/agents.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Agent Profile page loads and renders:
  - trust score + trend (snapshots)
  - primary skills
  - constraints learned
  - capability summary

## 6) Step-by-step plan
1. Add API client helpers (agents/trust/skills/snapshots).
2. Add route and navigation entry.
3. Implement page layout with clear sections and redacted JSON in Advanced.
4. Add i18n keys and minimal CSS.
5. Typecheck.

## 7) Risks & mitigations
- Risk: APIs not ready yet.
  - Mitigation: page shows “not available” gracefully when endpoints missing (404).

## 8) Rollback plan
Revert web-only PR.

