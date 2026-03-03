# Ops Dashboard (Standalone)

Standalone React/Vite dashboard for read-only Agent App operations endpoints.

## APIs consumed
- `POST /v1/system/health`
- `GET /v1/system/health/issues`
- `POST /v1/finance/projection`

## Runtime config (required)
Token is loaded at runtime from `public/config.json` (not from `VITE_` env).

1. Copy:
```bash
cp public/config.example.json public/config.json
```
2. Fill values in `public/config.json`:
- `apiBaseUrl`
- `defaultWorkspaceId`
- `bearerToken`
- `schemaVersion`
- poll intervals and finance range

`public/config.json` is gitignored.

## Run
```bash
pnpm -C apps/ops-dashboard dev
```

## Validate
```bash
pnpm -C apps/ops-dashboard test
pnpm -C apps/ops-dashboard typecheck
pnpm -C apps/ops-dashboard build
```

## Extending panels
1. Add panel component under `src/panels/<NewPanel>/index.tsx`
2. Add API file under `src/panels/<NewPanel>/api.ts`
3. Register panel in `src/panels/registry.ts`

Routes, sidebar, and overview cards are generated from the panel registry.
