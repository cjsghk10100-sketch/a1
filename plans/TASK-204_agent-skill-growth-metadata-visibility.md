# TASK-204: Agent Skill Growth Metadata Visibility

## 1) Problem
Agent Profile currently shows skill level/7d usage/reliability only. It does not expose when a skill was learned, when it was last used, or medium-term usage/impact signals, so growth interpretation is incomplete.

## 2) Scope
In scope:
- Extend Agent Profile skills UI to show:
  - learned_at
  - last_used_at
  - usage_30d
  - impact_score
- Add EN/KO i18n labels for the above fields.

Out of scope:
- API changes (fields already exist in `AgentSkillRow`).
- Skill scoring logic changes.

## 3) Constraints (Security/Policy/Cost)
- Read-only UI augmentation.
- Keep existing sorting/selection logic intact.
- No additional network calls.

## 4) Repository context
- Files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Open Agent Profile with recorded skills.
  2. Confirm each skill row shows learned/last-used timestamps, usage_30d, impact.

## 6) Step-by-step plan
1. Update skill row rendering in `AgentProfilePage.tsx` with added metadata fields.
2. Add EN/KO i18n keys for new labels.
3. Run typecheck + contracts for regression.

## 7) Risks & mitigations
- Risk: noisy UI.
- Mitigation: keep metadata compact in `skillMeta` rows and reuse existing styles.

## 8) Rollback plan
Revert `AgentProfilePage.tsx` skill row additions and related i18n keys.
