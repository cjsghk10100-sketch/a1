# TASK-232: Web Onboarding Uses Certify-Imported (One Request)

## 1) Problem
When both auto-verify and auto-assess are enabled, the web onboarding flow still makes separate requests.
This duplicates orchestration logic and can create transient mismatch between review and assess states.

## 2) Scope
In scope:
- Use `/skills/certify-imported` from web onboarding when both auto toggles are on.
- Keep existing fallback flows for verify-only and assess-only modes.
- Keep existing UI semantics (progress/result blocks) with minimal behavior change.

Out of scope:
- New backend endpoints
- i18n key additions (reuse existing texts)

## 3) Constraints (Security/Policy/Cost)
- Preserve actor/principal propagation through the new helper.
- Keep `only_unassessed=true` and bounded limit on assess side.
- No changes to policy/event semantics.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-232_web-onboarding-use-certify-imported.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes (regression).
- In onboarding import flow, with both auto toggles on, one certify request drives both review and assessment updates.

## 6) Step-by-step plan
1. Import `certifyImportedAgentSkills` helper in page API list.
2. Add `certifyImportedSkillsFromImport` async function that:
   - calls certify endpoint,
   - updates import status map, verify progress/errors, assess summary,
   - refreshes trust/skills/assessments + recommendation.
3. Switch import handler branch: both toggles on => certify function.
4. Run typecheck + full API contracts.

## 7) Risks & mitigations
- Risk: UI state drift if base import result is missing.
  - Mitigation: function accepts optional base result and uses current state fallback.
- Risk: duplicate refresh calls.
  - Mitigation: consolidate refresh inside certify helper.

## 8) Rollback plan
Revert page changes and this plan file.
