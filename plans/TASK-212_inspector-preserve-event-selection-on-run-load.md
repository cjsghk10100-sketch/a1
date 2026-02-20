# TASK-212: Inspector Deep Link Hardening (Preserve event_id with run_id)

## 1) Problem
When Inspector is opened with both `run_id` and `event_id` query params, initial run loading clears selected event state. This prevents direct "run context + exact event" deep-linking.

## 2) Scope
In scope:
- Update Inspector loading flow to preserve initial `event_id` when loading by `run_id` or `correlation_id` from URL.
- Update Agent Profile change-timeline deep-link to include `run_id` when available, while keeping `event_id`.

Out of scope:
- API/DB changes.
- New UI sections.

## 3) Constraints (Security/Policy/Cost)
- UI/read-path only. No policy gate/auth changes.
- No added dependencies.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/InspectorPage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- New files to add:
  - none

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Open `/inspector?run_id=<id>&event_id=<eid>`.
  2. Run/steps/toolcalls/artifacts load, and event detail for `<eid>` is selected.
  3. From Agent Profile change timeline row with run context, Inspector opens with both params.

## 6) Step-by-step plan
1. Add optional preserve-selected-event argument to Inspector load helpers.
2. Wire initial URL bootstrap to pass initial event id into run/correlation load.
3. Update Agent Profile event deep-link helper to include run id when present.
4. Run typecheck and API contract tests.

## 7) Risks & mitigations
- Risk: stale event selection on manual reload.
- Mitigation: preserve only on URL bootstrap path; default manual loads still clear selection.

## 8) Rollback plan
Revert Inspector/AgentProfile edits and keep event-only deep-link behavior.
