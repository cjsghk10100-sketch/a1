# TASK-424: PR-18G quasi-standalone desktop runtime

## Goal
Packaged AgentOS.app runs without repository path or pnpm dependency.

## Scope
- packaged mode (`app.isPackaged`) only:
  - launch API via node runtime on bundled JS build output
  - launch web panel via static files (no Vite)
- keep dev mode behavior unchanged (pnpm + source tree)
- include build artifacts in electron-builder package

## Acceptance
1. `/Applications/AgentOS.app` starts without DESKTOP_REPO_ROOT.
2. No `pnpm` spawn in packaged mode.
3. Ops dashboard loads and reaches `/health`, `/v1/system/health`, `/v1/finance/projection` via local API.
4. Existing desktop dev flow still works.
