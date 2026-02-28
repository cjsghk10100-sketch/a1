# Evidence Gate v0.1

## Purpose
Evidence Gate prevents false promotion in `/v1/pipeline/projection`.
An item can appear in `5_promoted` only when run/evidence/scorecard/incident conditions all pass.

## Stage Priority (high to low)
1. Lifecycle filter: archived/deleted items are excluded from all stages.
2. Active incident (`open`/`opened`/`escalated`) -> `6_demoted`.
3. Failed/timed-out/cancelled latest run -> `6_demoted`.
4. Failed scorecard -> `6_demoted`.
5. Rejected evidence -> `3_execute_workspace`.
6. Completed run + missing/pending scorecard -> `4_review_evidence`.
7. Evidence under review -> `4_review_evidence`.
8. Scorecard pass + strict gate pass -> `5_promoted`.
9. Created/started run -> `3_execute_workspace`.
10. Pending/held approval -> `2_pending_approval`.
11. Draft experiment -> `1_inbox`.
12. Fallback -> `1_inbox` with diagnostics.

## Ghost Evidence Defense
`scorecard=pass` alone is not enough.
Promotion requires:
- latest run is completed,
- evidence exists,
- evidence is not rejected,
- evidence belongs to latest run,
- no active incident.

If pass scorecard exists but evidence is missing/mismatched, stage is forced to `4_review_evidence` with `diagnostics=["ghost_evidence_or_mismatch"]`.

## Pagination Cursor
Projection keyset pagination uses a composite cursor:
- `cursor_updated_at`
- `cursor_entity_type`
- `cursor_entity_id`

Sort order and cursor order are aligned:
- `updated_at DESC, entity_type ASC, entity_id ASC`

Using only timestamp cursor is forbidden because tie timestamps can repeat rows.

## Rollback Plan
1. Revert `/v1/pipeline/projection` resolver/query changes.
2. Keep additive projection columns/tables unchanged if already migrated.
3. Re-run contract tests and confirm flat response compatibility before redeploy.

