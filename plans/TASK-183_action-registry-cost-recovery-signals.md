# TASK-183: Action Registry Cost/Recovery Signals for Approval Recommendation

## Summary
- 승인 추천 로직에 `비용 영향(cost_impact)` + `복구 난이도(recovery_difficulty)` 신호를 추가한다.
- 액션 레지스트리 metadata를 통해 신호를 표준화하고, Agent Profile에서 근거와 함께 표시한다.

## Scope
In scope:
- 마이그레이션으로 `sec_action_registry.metadata`에 기본 risk 신호 주입
  - `cost_impact`: low|medium|high
  - `recovery_difficulty`: easy|moderate|hard
- Agent Profile 승인 추천 로직에서 risk 신호 반영
  - high cost / hard recovery는 보수적으로 pre 추천
  - medium cost는 최소 post 추천
- Action Registry 테이블에 cost/recovery 컬럼 표시
- i18n EN/KO 키 추가

Out of scope:
- Policy Gate 런타임 강제 변경
- 비용($) 집계 시스템 추가

## Files
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/026_action_registry_risk_signals.sql` (new)
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## Acceptance
- `pnpm -r typecheck` 통과
- Agent Profile에서 추천 근거에 비용/복구 신호가 반영됨
- Action Registry 표에 cost/recovery 컬럼이 보임
