# TASK-201: Web Inspector Redaction Log Visibility

## 1) Problem
`/v1/audit/redactions` API exists, but operators still cannot inspect redaction/audit evidence from the web app. This weakens observability of DLP enforcement and forces manual curl/DB access.

## 2) Scope
In scope:
- Add web API helper for `GET /v1/audit/redactions`.
- In Inspector event detail view, fetch and render redaction logs for selected event.
- Add EN/KO i18n keys for redaction log section/fields/empty states.

Out of scope:
- API/DB schema changes.
- New filters/search screens beyond event-bound lookup.
- Changes to event projection/query contracts.

## 3) Constraints (Security/Policy/Cost)
- Request != Execute boundary unchanged (read-only UI).
- Never render secrets; reuse existing conservative JSON rendering.
- Keep implementation cheap: only fetch logs for selected event.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/InspectorPage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/api/http.ts`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/api/audit.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes (CI parity regression check).
- Manual:
  1. Open `/inspector`, load a run with DLP-detected events.
  2. Select event with `contains_secrets=true`.
  3. Confirm redaction log rows show action/rule/time/details (or empty state message).

## 6) Step-by-step plan
1. Add `apps/web/src/api/audit.ts` with typed helper `listRedactionLogs({ event_id, limit })`.
2. Extend `InspectorPage` state/effects to load redaction logs when `selectedEventId` changes.
3. Render a redaction log section under event detail (loading/error/empty/rows).
4. Add EN/KO i18n keys for section title, empty state, and row fields.
5. Run typecheck + API tests; fix any regressions.

## 7) Risks & mitigations
- Risk: extra network requests while browsing events.
- Mitigation: fetch only for selected event, cap limit, and cancel stale responses with token guard.
- Risk: UI clutter in Inspector.
- Mitigation: compact list + details JSON, keep section event-scoped only.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/audit.ts`
- Inspector redaction section changes in `InspectorPage.tsx`
- i18n keys in `resources.ts`
This restores previous Inspector behavior without affecting backend contracts.
