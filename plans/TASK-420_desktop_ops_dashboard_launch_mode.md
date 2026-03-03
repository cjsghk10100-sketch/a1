# TASK-420 Desktop launch mode for Ops Dashboard

## Goal
- Add desktop runtime mode to launch `apps/ops-dashboard` inside Electron.
- Keep existing `apps/web` mode as default.
- Auto-provision runtime `apps/ops-dashboard/public/config.json` with API base, workspace, and bearer token.

## Scope
- `apps/desktop/src/main.cjs`: add `DESKTOP_WEB_APP` switch, ops config bootstrap, start URL selection.
- `apps/desktop/package.json` + root `package.json`: add ops desktop dev script.
- `.env.desktop.example`: document new mode/env requirements.

## Acceptance
- `pnpm -C apps/desktop typecheck` passes.
- `DESKTOP_WEB_APP=ops-dashboard pnpm -C apps/desktop dev` starts and loads `/overview`.
- Existing default desktop mode remains unchanged.
