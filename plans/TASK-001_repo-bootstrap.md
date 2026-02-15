# TASK-001 — Repo bootstrap (monorepo + pnpm + basic CI + docs skeleton)

### 1) Problem
Repository currently has governance/docs scaffolding, but lacks executable monorepo bootstrap primitives (workspace manifest, package manifests, runnable root scripts, CI workflow). Without this, subsequent tasks cannot reliably run install/lint/test in a consistent way.

### 2) Scope
In scope:
- Add pnpm workspace and root package scripts.
- Add minimal package manifests for `apps/api`, `apps/web`, `packages/shared`.
- Add basic GitHub Actions CI for install/lint/test.
- Add bootstrap-level docs skeleton for contributors.

Out of scope:
- Application runtime implementation.
- DB schema/migrations for event store.
- Production deployment pipelines.

### 3) Constraints (Security/Policy/Cost)
- Request != Execute boundaries: no external write integrations are implemented in this task.
- Redaction rules: no secrets are introduced in scripts or CI logs.
- Budget caps: keep CI cheap-by-default (single Node version, simple steps).

### 4) Repository context
- Existing relevant files (paths):
  - `AGENTS.md`
  - `PLANS.md`
  - `BACKLOG.md`
  - `docs/CODEX_WORKFLOW.md`
- New files to add (paths):
  - `package.json`
  - `pnpm-workspace.yaml`
  - `.npmrc`
  - `.github/workflows/ci.yml`
  - `apps/api/package.json`
  - `apps/web/package.json`
  - `packages/shared/package.json`
  - `docs/README.md`
  - `docs/ARCHITECTURE.md`

### 5) Acceptance criteria (observable)
- Commands to run:
  - `pnpm -r lint`
  - `pnpm -r test`
  - `pnpm lint`
  - `pnpm test`
- Expected outputs:
  - Commands exit 0 and show each workspace script execution.

### 6) Step-by-step plan
1. Replace this task file with self-contained plan context.
2. Add root workspace/package/bootstrap config for pnpm monorepo.
3. Add per-package minimal manifests with lint/test placeholders.
4. Add basic CI workflow that installs deps and runs lint/test.
5. Add docs skeleton files for bootstrap navigation.
6. Run acceptance checks and commit.

### 7) Risks & mitigations
- Risk: CI could fail due to lockfile strict mode.
- Mitigation: run `pnpm install --no-frozen-lockfile` in CI until lockfile policy is formalized.

### 8) Rollback plan
Revert the commit that introduces workspace/CI scaffolding (`git revert <commit_sha>`). Since no migrations or data changes are involved, rollback is safe and immediate.
