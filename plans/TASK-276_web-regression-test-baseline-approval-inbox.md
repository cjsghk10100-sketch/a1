# TASK-276: Web Regression Test Baseline (Approval Inbox)

## Summary
Establish a minimal web test baseline and lock the Approval Inbox stale-selection fixes with an automated regression test.

## Problem
Recent UI hardening patches prevent async stale overwrites, but without web tests these guarantees can regress silently.

## Scope
- Add web test runner baseline for `apps/web` (Vitest + jsdom).
- Add one focused regression test for `ApprovalInboxPage`:
  - Selecting an approval item should **not** trigger approval list re-fetch.
- Wire web tests into GitHub Actions CI.

Out of scope:
- Broad component test coverage
- E2E/browser automation
- API contract changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/package.json`
- `/Users/min/Downloads/에이전트 앱/apps/web/vite.config.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/ApprovalInboxPage.test.tsx`
- `/Users/min/Downloads/에이전트 앱/.github/workflows/ci.yml`
- `/Users/min/Downloads/에이전트 앱/pnpm-lock.yaml`

## Acceptance
- `pnpm install`
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
