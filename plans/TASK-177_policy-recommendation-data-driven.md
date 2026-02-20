# TASK-177: Data-Driven Approval Recommendation (Action Registry Based)

## Summary
- Replace heuristic-only approval recommendation with action-registry-backed logic.
- Use `reversible`, `zone_required`, `requires_pre_approval`, `post_review_required` to compute recommendation.

## Scope
In scope:
- Agent Profile recommendation logic update only.

Out of scope:
- API/DB changes
- Policy enforcement changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- Recommendation reacts to action registry flags for scoped actions.
- High-stakes / pre-required actions are always shown as `pre` (or `blocked` if quarantined).
