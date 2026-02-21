# TASK-235: Web Onboarding "Certify Imported" Button

## 1) Problem
Onboarding has separate verify/assess controls and auto-flow toggles, but no explicit one-click action for full certification.

## 2) Scope
In scope:
- Add a dedicated "Certify imported" button in onboarding review section.
- Button calls existing `certifyImportedSkillsFromImport` flow.
- Add EN/KO i18n key for the button label.

Out of scope:
- API changes
- DB changes

## 3) Constraints (Security/Policy/Cost)
- Reuse existing certify flow logic and actor/principal propagation.
- Keep button disabled during in-flight onboarding actions.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-235_web-onboarding-certify-button.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Onboarding review section shows a "Certify imported" action and triggers full certify flow.

## 6) Step-by-step plan
1. Add i18n key for button label.
2. Add button wired to `certifyImportedSkillsFromImport(skillImportResult)`.
3. Set proper disabled conditions.
4. Run typecheck.

## 7) Risks & mitigations
- Risk: user confusion with verify button.
  - Mitigation: keep existing verify behavior; add explicit certify action.

## 8) Rollback plan
Revert UI/i18n changes and this plan file.
