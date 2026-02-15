# API Agent Notes

Scope: `apps/api/**`

- Prioritize auth/policy middleware before handlers.
- Any external write path must be approval-gated.
- Do not log tokens, keys, or raw PII.
