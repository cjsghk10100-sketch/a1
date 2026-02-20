# TASK-202: Web Inspector Hash-Chain Verify Visibility

## 1) Problem
Audit hash-chain verification exists only as API (`/v1/audit/hash-chain/verify`) and contract test coverage. Operators cannot verify stream integrity from the web UI, so day-to-day audit checks still require curl.

## 2) Scope
In scope:
- Extend web audit API helper with hash-chain verify request/response types.
- Add Inspector event-detail UI to trigger stream hash-chain verification.
- Show verify result summary (`valid`, `checked`, `last_event_hash`, `first_mismatch`) with loading/error handling.
- Add EN/KO i18n keys for the new Inspector hash-chain section.

Out of scope:
- Backend/API/schema changes.
- Auto background verification jobs.
- Cross-stream aggregate dashboards.

## 3) Constraints (Security/Policy/Cost)
- Read-only audit operation; no policy bypass.
- Keep requests bounded by a capped `limit`.
- Do not expose secret material; display only existing hash-check metadata.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/api/audit.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/InspectorPage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Open `/inspector` and load any run/correlation with events.
  2. Select an event, click hash-chain verify.
  3. Result card shows valid/invalid status and checked stream metadata.

## 6) Step-by-step plan
1. Add `verifyHashChain(...)` helper in `apps/web/src/api/audit.ts`.
2. Add Inspector state/actions for hash-chain verify bound to selected event stream.
3. Render hash-chain section under event detail with verify button and result fields.
4. Add i18n keys (EN/KO) for section labels/status text.
5. Run typecheck and API contract tests.

## 7) Risks & mitigations
- Risk: verify on large streams can be slow.
- Mitigation: cap limit and make verification user-triggered (manual button).
- Risk: stale result shown after selecting another event.
- Mitigation: clear verify state on `selectedEventId` change.

## 8) Rollback plan
Revert changes in:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/audit.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/InspectorPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- `/Users/min/Downloads/에이전트 앱/plans/TASK-202_web-inspector-hash-chain-verify.md`
