# GitHub Push/PR Checklist

This repo currently has local branches for each task:

- `codex/task-001-repo-bootstrap` (`ac1a854`)
- `codex/task-002-infra-postgres` (`b93f898`)
- `codex/task-003-migration-runner` (`4ac4bbc`)
- `codex/task-004-shared-foundation` (`195b914`)
- `codex/task-005-api-skeleton` (`e72174f`)
- `codex/task-010-event-store-migration` (`e0426b0`)
- `codex/task-011-projector-migration` (`1dd3950`)
- `codex/task-012-core-projections-migration` (`8919948`)
- `codex/task-006-event-store-writer` (`f2a083f`)
- `codex/task-007-core-projector` (`e50f7c2`)
- `codex/task-008-core-api-endpoints` (`b2ea76a`)
- `codex/task-009-room-sse-stream` (`2a287a1`)

Recommended PR order (dependency order):
`001 -> 002 -> 003 -> 004 -> 005 -> 010 -> 011 -> 012 -> 006 -> 007 -> 008 -> 009`

## Preflight (Local)

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
```

## Add Remote

```bash
git remote add origin <YOUR_GITHUB_REPO_URL>
git remote -v
```

## Option A: One-Shot Push (No Per-Task PRs)

Push current `main` as-is:

```bash
git push -u origin main
```

## Option B: Strict “1 PR per TASK” Flow

If you want 12 PRs with CI gating, start `origin/main` from the plans-only commit:

- Baseline commit: `5e37967` ("chore: add task plans (TASK-001..012)")

On a new/empty GitHub repo:

```bash
git push -u origin 5e37967:main
```

Then push task branches:

```bash
git push -u origin codex/task-001-repo-bootstrap
git push -u origin codex/task-002-infra-postgres
git push -u origin codex/task-003-migration-runner
git push -u origin codex/task-004-shared-foundation
git push -u origin codex/task-005-api-skeleton
git push -u origin codex/task-010-event-store-migration
git push -u origin codex/task-011-projector-migration
git push -u origin codex/task-012-core-projections-migration
git push -u origin codex/task-006-event-store-writer
git push -u origin codex/task-007-core-projector
git push -u origin codex/task-008-core-api-endpoints
git push -u origin codex/task-009-room-sse-stream
```

Create PRs in the recommended order, always targeting `main`.

### CI Gate (Per PR)

Confirm GitHub Actions is green, at minimum for:

- `pnpm install --frozen-lockfile`
- `pnpm -r typecheck`

## Notes

- Never commit `.env` (only `.env.example`).
- This local history includes some local merge commits inside the task branches. Diffs should still be correct, but if you want “clean/linear” PR branches (no merge commits in the branch history), tell me and I can generate a separate set of linear branches for PRs.

