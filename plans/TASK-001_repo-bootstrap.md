# TASK-001 Repo bootstrap (pnpm monorepo + docs + CI)

## 1) Problem
We need a Codex-friendly repository skeleton with:
- pnpm workspaces
- basic TS + lint/format conventions
- docs scaffolding (AGENTS/PLANS/BACKLOG + /docs skeleton)
- GitHub CI + templates

## 2) Scope
In scope:
- Create monorepo layout: /apps, /packages, /infra, /docs, /plans
- Add pnpm workspace + root package.json scripts (typecheck/lint/format/test; test may be placeholder)
- Add root docs: AGENTS.md / PLANS.md / BACKLOG.md / README.md
- Add /docs skeleton files
- Add GitHub Actions CI + PR/issue templates

Out of scope:
- Real API logic, DB migrations, UI screens

## 3) Constraints (Security/Policy/Cost)
- No secrets committed; provide .env.example only
- Keep dependencies minimal
- Every user-facing string later must be i18n (EN+KO), but not required in this task

## 4) Repository context
New files to add:
- /pnpm-workspace.yaml
- /package.json (root)
- /.env.example
- /tsconfig.base.json
- /.editorconfig
- /.gitignore
- /AGENTS.md
- /PLANS.md
- /BACKLOG.md
- /README.md
- /docs/SPEC_v1_1.md
- /docs/CODEX_WORKFLOW.md
- /docs/CODEX_PROMPTS.md
- /docs/EVENT_SPECS.md
- /biome.json
- /.github/workflows/ci.yml
- /.github/ISSUE_TEMPLATE/codex-task.md
- /.github/pull_request_template.md
- /apps/api/package.json + src/index.ts (placeholder)
- /apps/web/package.json + src/main.ts (placeholder; avoid TSX until UI stack is chosen)
- /packages/shared/package.json + src/index.ts (placeholder)

## 5) Acceptance criteria (observable)
- `pnpm install` succeeds on a clean checkout (lockfile committed)
- `pnpm -r typecheck` succeeds (even if minimal)
- `pnpm lint` + `pnpm format:check` succeed (Biome)
- CI workflow runs `pnpm -r typecheck` (and lint/format checks) successfully on PR
- Repo has required docs (`/docs` skeleton + AGENTS/PLANS/BACKLOG) and templates

## 6) Step-by-step plan
1) Create pnpm workspace config listing `apps/*` and `packages/*`
2) Create root package.json:
   - set `packageManager` (pnpm) and Node engine (pick an LTS, e.g. 20)
   - scripts:
     - typecheck: `pnpm -r typecheck`
     - lint: `biome lint .`
     - format: `biome format --write .`
     - format:check: `biome format .`
     - test: placeholder (must exist; can be no-op for now)
3) Add `.env.example` (empty/default values only)
4) Add base TS config (`tsconfig.base.json`) and per-package `tsconfig.json` that extends it
5) Scaffold `apps/api`, `apps/web`, `packages/shared`:
   - keep placeholders in plain `.ts` so `pnpm -r typecheck` passes without framework deps
   - each package has `typecheck` script (tsc -p tsconfig.json)
6) Add docs skeleton:
   - `docs/SPEC_v1_1.md`, `docs/CODEX_WORKFLOW.md`, `docs/CODEX_PROMPTS.md`, `docs/EVENT_SPECS.md`
7) Add Biome config (`biome.json`)
8) Add GitHub CI workflow:
   - setup Node, enable Corepack, `pnpm install --frozen-lockfile`
   - run `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check`
9) Add GitHub issue/PR templates

## 7) Risks & mitigations
- Risk: TypeScript configs inconsistent across packages
  - Mitigation: base tsconfig extends in each package
- Risk: `apps/web` placeholder TSX requires React types and breaks typecheck
  - Mitigation: keep `apps/web` placeholder as `.ts` until web stack is chosen

## 8) Rollback plan
Revert this PR (pure scaffolding).
