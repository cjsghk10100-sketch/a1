# TASK-167: Web Agent Profile Visual Hardening (Permissions/Growth)

## Summary
- Improve operator readability for Agent OS posture without changing backend contracts.
- Add visual summaries for:
  - permissions matrix (read/write/external/high-stakes),
  - zone ring (sandbox/supervised/high-stakes),
  - delegation chain summary (depth/root/delegated count),
  - growth deltas (trust/autonomy 7D trend).

## Scope
In scope:
- Web-only UI enhancement in Agent Profile.
- EN/KO i18n keys for the new visual labels.
- Lightweight CSS for readability.

Out of scope:
- API/DB/event schema changes.
- Policy decision logic changes.
- Token issuance/revocation behavior changes.

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/styles.css`

## Acceptance
- Agent Profile shows matrix/zone/delegation summary in `Permissions`.
- Agent Profile shows 7D trust/autonomy deltas in `Growth`.
- Existing actions (recommend/approve/quarantine/package verify) remain unchanged.
