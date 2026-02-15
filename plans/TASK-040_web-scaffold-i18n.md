# TASK-040 Web scaffold + i18n (en/ko) wiring

## 1) Problem
We need a real `apps/web` foundation so we can build the Agent OS UI (Approval Inbox / Timeline / Inspector) as a thin consumer of stable backend contracts.

## 2) Scope
In scope:
- Convert `apps/web` from placeholder TS to a runnable web app scaffold (Vite + React + TS).
- Add i18n wiring with EN/KO resources; enforce the rule that all visible strings come from i18n.
- Add minimal navigation + placeholder pages for: Timeline / Approval Inbox / Inspector (no feature implementation).

Out of scope:
- Implementing any backend endpoints, DB schema/migrations, or event/projector changes.
- Implementing real Timeline/SSE UI, Approval workflows, or Inspector querying UX (those are later tasks).

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep dependencies small and mainstream.
- UI must not leak secrets by default; placeholders only in this task.

## 4) Repository context
Existing files:
- `apps/web/package.json`
- `apps/web/src/main.ts` (placeholder)
- `apps/web/AGENTS.md` (requires i18n for visible strings)

New/updated files:
- `apps/web/index.html`
- `apps/web/vite.config.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/i18n/*`
- `apps/web/src/pages/*`
- `apps/web/src/styles.css`

## 5) Acceptance criteria (observable)
- `pnpm install` succeeds on a clean checkout (lockfile updated).
- `pnpm -r typecheck` passes (CI typecheck job).
- `pnpm -C apps/web dev` starts a local dev server without runtime errors.

## 6) Step-by-step plan
1) Add Vite + React scaffold under `apps/web`.
2) Wire i18n (i18next + react-i18next) with EN/KO resources and a simple language toggle persisted to localStorage.
3) Add minimal navigation routes + placeholder pages (no real data fetching).
4) Update package.json + lockfile and ensure `pnpm -r typecheck` is green.

## 7) Risks & mitigations
- Risk: i18n keys drift / raw strings sneak into UI
  - Mitigation: centralize strings in i18n resources; keep pages minimal.
- Risk: toolchain config mismatch with repo TS conventions
  - Mitigation: keep `apps/web/tsconfig.json` extending `tsconfig.base.json` and only override web-specific options.

## 8) Rollback plan
Revert this PR (web-only scaffolding).

