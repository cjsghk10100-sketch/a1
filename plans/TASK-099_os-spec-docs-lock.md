# TASK-099: OS Spec Lock (Docs) - contracts first

## 1) Problem
We have consensus on an OS-level contract (principals, zones, capability tokens, egress gateway, supply-chain, audit immutability) plus a growth layer (trust/skills/mistakes/snapshots).
If we don’t lock these definitions in-repo, implementation will drift and later changes will be expensive/breaking.

## 2) Scope
In scope:
- Update docs to reflect the agreed OS-level contract:
  - Event envelope fields (including new additive fields planned: `actor_principal_id`, `zone`)
  - 3-zone security model and reversible/irreversible action registry concept
  - Capability tokens + delegation chain constraints
  - Egress gateway as a single outbound path
  - Skill/tool supply-chain verification model
  - Secrets vault + redaction + DLP expectations
  - Audit log immutability + hash-chain cutover rule
  - Growth layer: trust score, skill ledger/assessment, learning-from-failure, daily snapshots, quarantine
- Fix existing doc inconsistencies (e.g. `event_name` vs `event_type` terminology).

Out of scope:
- Any code/DB changes.
- Any new API endpoints or UI work.

## 3) Constraints (Security/Policy/Cost)
- Docs must be self-contained (no “see other doc” for required definitions).
- Prefer additive/compatible wording: we will introduce new envelope fields as optional first, then tighten later.
- Do not include secrets, tokens, or private URLs.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/docs/SPEC_v1_1.md`
- `/Users/min/Downloads/에이전트 앱/docs/EVENT_SPECS.md`

## 5) Acceptance criteria (observable)
- Specs clearly define:
  - OS P0 invariants (principals, zone, action registry, egress, supply-chain, secrets, audit)
  - P1 growth invariants (trust, skills, mistakes, snapshots, quarantine)
- `docs/EVENT_SPECS.md` uses `event_type` consistently and matches the codebase naming.
- No code changes; CI remains green.

## 6) Step-by-step plan
1. Update `docs/EVENT_SPECS.md`:
   - Use `event_type` terminology
   - List required envelope metadata fields (current + planned additive fields)
   - Add a short “compatibility” note: new envelope fields start optional.
2. Update `docs/SPEC_v1_1.md`:
   - Fill in Summary/Goals/Architecture/Security sections with the OS-level contract
   - Add a “Zones” section and “Action registry” section
   - Add a “Growth layer” section describing trust/skills/mistakes/snapshots
3. Quick consistency scan: ensure docs match existing endpoints and event names.

## 7) Risks & mitigations
- Risk: Docs promise more than we can implement quickly.
  - Mitigation: mark parts as “P0” (must-haves) vs “P1/P2” (later), and keep implementation notes concrete.

## 8) Rollback plan
Revert the commit(s) editing the docs.

