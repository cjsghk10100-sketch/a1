# TASK-251: Agent Profile Stale-Agent Async Guards

## Summary
에이전트 선택을 바꾼 뒤 늦게 도착한 비동기 응답이 현재 선택 에이전트의 상태를 오염시키지 않도록, Agent Profile의 agent-scoped reload 함수에 stale-agent 가드를 추가한다.

## Scope
In scope:
- 현재 선택 agent_id를 ref로 추적
- agent-scoped reload 함수(`reloadApprovalRecommendation`, `reloadChangeEvents`, `reloadOnboardingStatus`, `refreshAgentGrowthViews`)에 stale guard 적용
- stale 응답은 현재 상세 패널 state를 덮어쓰지 않도록 차단

Out of scope:
- API/DB 변경
- 기능 추가

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual:
  - Agent A에서 로딩 중 Agent B로 전환해도 A 응답이 B 상세 패널을 덮어쓰지 않는다.
