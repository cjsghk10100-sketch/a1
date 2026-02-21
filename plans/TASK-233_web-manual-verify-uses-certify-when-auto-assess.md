# TASK-233: Manual Verify Uses Certify When Auto-Assess Enabled

## 1) Problem
In onboarding, import auto-flow now uses `certify-imported` when both toggles are enabled, but manual "Verify pending" still uses separate review + optional assess flow.

## 2) Scope
In scope:
- When user clicks "Verify pending" and auto-assess toggle is on, use certify flow.
- Keep existing behavior for verify-only mode.

Out of scope:
- API changes
- UI copy changes

## 3) Constraints (Security/Policy/Cost)
- Preserve same actor/principal propagation through certify path.
- Keep existing button enabled/disabled conditions.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-233_web-manual-verify-uses-certify-when-auto-assess.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Manual verify path follows certify when auto-assess is enabled.

## 6) Step-by-step plan
1. Branch `verifyPendingPackagesFromImport` by auto-assess toggle.
2. Use `certifyImportedSkillsFromImport(skillImportResult)` when enabled.
3. Keep fallback to `verifyPendingSkillPackageIds` for verify-only mode.
4. Run typecheck.

## 7) Risks & mitigations
- Risk: accidental behavior change in verify-only mode.
  - Mitigation: explicit branch, unchanged existing call path for false case.

## 8) Rollback plan
Revert page logic change and this plan file.
