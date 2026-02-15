# TASK-108: Secrets Vault + Runtime Injection + Redaction/DLP hooks (opt-in)

## Dependencies
- TASK-101 redaction event type recommended
- Existing redaction columns in `evt_events`

## 1) Problem
We must ensure secrets never end up in:
- prompts
- event payloads
- artifacts/messages
- logs

We need an OS-level secrets vault with runtime injection, plus DLP/redaction hooks.
This must not break local dev when secrets are not configured.

## 2) Scope
In scope:
- DB:
  - `sec_secrets` table (encrypted-at-rest values)
  - `sec_redaction_log` (optional) for DLP findings
- Config:
  - `SECRETS_MASTER_KEY` env var (required only to use the vault endpoints)
  - If missing, API starts normally and vault endpoints return 501 or deny.
- API:
  - `POST /v1/secrets` (create/update secret metadata + value)
  - `GET /v1/secrets` (list metadata; never return secret values)
  - `POST /v1/secrets/:id/access` (returns decrypted secret to **service principal only**; records audit event)
- Redaction/DLP hook:
  - On event append / message/artifact create, run a lightweight scanner:
    - mark `contains_secrets=true` and/or emit `secret.leaked.detected` when patterns match
    - do not block by default (shadow), but record for growth/forensics
- Events:
  - `secret.accessed`
  - `secret.leaked.detected`
  - `event.redacted` (if we implement automatic redaction markers)

Out of scope:
- A full key-rotation system.
- Heavy DLP (PII classification) beyond minimal patterns.

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**:
  - `SECRETS_MASTER_KEY` must not become required for existing endpoints.
  - Existing contract tests must stay green.
- Never log decrypted secret values.
- Never store decrypted values in events.

## 4) Repository context
New files:
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/migrations/017_secrets_vault.sql`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/src/security/cryptoVault.ts`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/src/security/dlp.ts`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/src/routes/v1/secrets.ts`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/packages/shared/src/secrets.ts`

Config docs:
- `.env.example` (add placeholder for `SECRETS_MASTER_KEY`)
- `README.md` update (local-only setup notes)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- API starts without `SECRETS_MASTER_KEY` and existing endpoints work
- With `SECRETS_MASTER_KEY` set:
  - create secret, list metadata, access secret
  - `secret.accessed` event is emitted on access

## 6) Step-by-step plan
1. Add shared types for secrets metadata and access events.
2. Add migration for `sec_secrets` (encrypted blob + metadata).
3. Implement crypto helper:
   - AES-GCM with random nonce
   - key derived from `SECRETS_MASTER_KEY` (hash to 32 bytes)
4. Implement routes:
   - guard: if key missing -> 501
   - never return secret values except access endpoint
5. Add lightweight DLP scanner and hook it into event append pipeline (shadow).
6. Add contract test around access auditing (no secret leakage in events).

## 7) Risks & mitigations
- Risk: Vault introduces a new operational requirement.
  - Mitigation: endpoints are opt-in; missing key doesn’t break the app.

## 8) Rollback plan
Revert PR. Leave schema; unused unless vault enabled.

