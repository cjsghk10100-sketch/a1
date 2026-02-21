# TASK-219: Embedded Worker Env + Local Run Docs

## 1) Problem
`TASK-218` added an opt-in embedded worker loop, but local operators still cannot discover/configure it from `.env.example` and README.
Without docs, users may assume queued runs are broken when worker mode is not enabled.

## 2) Scope
In scope:
- Document embedded worker env flags in `.env.example`.
- Update `README.md` with practical local run options:
  - API only + standalone worker script
  - API with embedded worker enabled
- Keep docs concise and copy-paste ready.

Out of scope:
- API code changes
- Web UI changes
- Additional scripts

## 3) Constraints (Security/Policy/Cost)
- Do not introduce secrets in docs/examples.
- Keep defaults cheap/safe (`RUN_WORKER_EMBEDDED=0`).
- Preserve existing setup instructions.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/.env.example`
- `/Users/min/Downloads/에이전트 앱/README.md`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-219_embedded-worker-env-and-local-run-docs.md`

## 5) Acceptance criteria (observable)
- `.env.example` contains embedded worker flags with comments.
- README has explicit section describing how queued runs are processed in local mode.
- `pnpm -r typecheck` still passes (no code regressions).

## 6) Step-by-step plan
1. Add embedded worker env keys to `.env.example`.
2. Add README section for local execution modes (standalone worker vs embedded worker).
3. Run typecheck as a quick regression gate.

## 7) Risks & mitigations
- Risk: confusing dual mode docs.
  - Mitigation: present clear “choose one” options with exact commands/env values.

## 8) Rollback plan
Revert docs-only commit.
