# TASK-051: Search (proj_search_docs + API + Work UI)

## 1) Problem
We already have `proj_search_docs` (pg_trgm) in the DB schema, but nothing populates it and there is no search API/UI.
That makes it hard to operate the OS day-to-day (finding past context, debugging, auditing) without manual scrolling.

## 2) Scope
In scope:
- API:
  - Populate `proj_search_docs` for `message.created` events (doc_type = `message`).
  - Add `GET /v1/search` endpoint to query `proj_search_docs` by substring (ILIKE).
- Web:
  - Add a minimal search box + results list to `/work` (scoped to the currently selected room).

Out of scope:
- Full-text search (tsvector), ranking, or cross-table joins.
- Index/migration changes (table already exists).
- Search over artifacts/runs/approvals (messages only for now).

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Search must be read-only and not bypass existing policy boundaries (server still enforces workspace scoping).
- Keep responses small: return a preview (truncated content) rather than full blobs.

## 4) Repository context
Relevant files:
- `/apps/api/src/projectors/coreProjector.ts` (message.created projector)
- `/apps/api/migrations/003_core_projections.sql` (proj_search_docs exists)
- `/apps/api/src/routes/v1/index.ts` (route registration)
- `/apps/web/src/pages/WorkPage.tsx` (Work UI)
- `/apps/web/src/i18n/resources.ts` (labels)
- `/apps/web/src/styles.css` (optional highlight/layout)

New files:
- `/apps/api/src/routes/v1/search.ts`
- `/apps/api/test/contract_search.ts`
- `/apps/web/src/api/search.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual smoke:
  1. Run API + web.
  2. Create a room/thread/message containing a unique term (e.g. `hello-search-123`).
  3. In `/work`, search that term.
  4. Result appears and clicking it switches to the correct thread.

## 6) Step-by-step plan
1. API: extend `coreProjector` to upsert `proj_search_docs` on `message.created`.
2. API: add `GET /v1/search?q=...&room_id=...&limit=...` (workspace-scoped).
3. Tests: add `contract_search.ts` and include it in the API test script chain.
4. Web: add `searchDocs()` API helper + UI in Work page.
5. Run typecheck + contract tests.

## 7) Risks & mitigations
- Risk: `q` is too short and causes heavy scans.
  - Mitigation: require `q.trim().length >= 2` (400 on API, disable search button in UI).
- Risk: `proj_search_docs` isn't populated in existing DBs until new events occur.
  - Mitigation: acceptable for MVP; docs are populated going forward.

## 8) Rollback plan
Revert the PR (purely additive behavior; no schema changes).

