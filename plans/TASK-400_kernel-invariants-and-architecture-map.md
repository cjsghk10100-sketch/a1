# TASK-400: Kernel invariants checklist + architecture map + invariant smoke test

## 1) Problem
Self-improvement loop features (evidence/experiment/score/promotion) can drift into rewrite patterns unless the kernel contract is explicit and tested.
We need:
- a kernel invariants checklist (hard rules),
- an architecture map (current boundaries),
- an invariant smoke test that fails fast on regressions.

## 2) Scope
In scope:
- add `MIN_ORG/01_CONSTITUTION/KERNEL_INVARIANTS_CHECKLIST.md`
- add `apps/api/test/contract_kernel_invariants.ts`
- wire it into `apps/api/package.json` test chain

Out of scope:
- non-additive schema rewrites
- UI changes

## 3) Constraints (Security/Policy/Cost)
- Contract freeze: keep `evt_events` and core `proj_*` semantics stable.
- No rewrite bias: reject DB/framework/architecture replacement.
- DLP assertions must run through `appendToStream` or routes that call it.

## 4) Repository context
Key files:
- `apps/api/migrations/001_evt_event_store.sql` (append-only trigger/idempotency index)
- `apps/api/src/eventStore/index.ts` (DLP/redaction/hash chain path)
- `apps/api/src/policy/policyGate.ts` (`external.write` => `require_approval`)
- `apps/api/src/routes/v1/streams.ts` (SSE `from_seq`/`stream_seq`)
- `apps/api/test/contract_policy_enforcement.ts`
- `apps/api/test/contract_room_sse.ts`
- `apps/api/test/contract_secrets.ts`

## 5) Architecture map (current kernel)
- Write model:
  - `appendToStream()` appends events, allocates `stream_seq`, applies DLP/redaction markers, and writes hash chain fields.
- Read model:
  - projectors apply domain events into `proj_*`.
- Boundary:
  - policy gate + approvals enforce Request != Execute.
- Execution trace:
  - run/step/tool/artifact events and projections are canonical.
- Realtime:
  - room stream is primary operational feed (`from_seq` resume).

## 6) Acceptance criteria (observable)
- checklist file exists and is committed.
- `pnpm -C apps/api test` includes and passes `contract_kernel_invariants.ts`.
- `pnpm -r typecheck` passes.

## 7) Step-by-step
1. Add kernel checklist file.
2. Implement `contract_kernel_invariants.ts`:
   - assert default `external.write` decision is `require_approval`
   - assert room SSE emits monotonic `stream_seq` and `from_seq` resume works
   - assert `UPDATE evt_events` fails due append-only trigger
   - assert DLP/redaction side effects (`contains_secrets`, `event.redacted`, `secret.leaked.detected`, redaction log rows)
3. Add test script invocation in API test chain.
4. Run typecheck and API contracts.

## 8) Risks & mitigations
- Risk: append-only DB error text can vary.
  - Mitigation: assert failure class + fallback substring.
- Risk: DLP rule text can evolve.
  - Mitigation: assert behavior (flags/events/log rows), not exact rule ids.

## 9) Rollback
- Revert doc + test + test-script wiring commit.
- No persistent schema change.
