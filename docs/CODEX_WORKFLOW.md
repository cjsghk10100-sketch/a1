# CODEX_WORKFLOW

## Branch/PR Workflow
1. Pick one task from `/plans`.
2. Implement in small increments (target ~1 hour scope).
3. Validate locally (`lint`, `test`, task-specific checks).
4. Commit with clear message.
5. Open PR with summary, risk, rollback notes.

## Guardrails
- Never bypass policy/auth checks.
- If execution safety is uncertain, create approval request path first.
- Failures must produce RCA + Learning Ledger updates before closure.

## Definition of Done
- Code builds/tests pass.
- Docs/spec/plan updated.
- EN/KO keys included for any new UI text.
- No secrets leaked in code/logs/examples.
