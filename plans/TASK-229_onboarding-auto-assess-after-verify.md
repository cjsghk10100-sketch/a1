# TASK-229: Onboarding Auto-Assess After Verify (First Auth One-Click)

## 1) Problem
Onboarding currently supports auto-verify for pending imported packages, but assessment still needs a separate manual action.
For first authentication, this adds friction and makes growth/trust signals appear later than necessary.

## 2) Scope
In scope:
- Add onboarding option to auto-run batch assessment after import/verify.
- Trigger existing `assess-imported` API automatically in onboarding flow.
- Keep manual "Assess verified" button for explicit retries.
- Add EN/KO i18n keys for the new option and status text.

Out of scope:
- API schema/database changes
- New backend endpoints
- Assessment scoring logic changes

## 3) Constraints (Security/Policy/Cost)
- Keep actor/principal traceability by reusing existing assessment call path.
- Do not auto-assess while verify is still running.
- Use existing `only_unassessed=true` default to avoid duplicate assessments.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-229_onboarding-auto-assess-after-verify.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes (regression parity).
- In `/agent-profile` onboarding:
  - Import with auto-verify enabled runs verification and then auto-assessment.
  - Summary line shows assessed/skipped counts without manual button click.

## 6) Step-by-step plan
1. Add `autoAssessVerifiedOnImport` state (default true) and reset behavior.
2. Refactor assessment call to support `silent`/`clearPrevious` options for auto path.
3. Invoke assessment automatically after auto-verify completes and after import when verified items already exist.
4. Add i18n keys for checkbox label and auto-running status text.
5. Run typecheck + full API contracts.

## 7) Risks & mitigations
- Risk: user confusion between manual and auto assessment.
  - Mitigation: explicit checkbox + loading/status text.
- Risk: duplicate assessment attempts.
  - Mitigation: keep `only_unassessed=true` in API call.

## 8) Rollback plan
Revert web onboarding changes and this plan file in one commit.
