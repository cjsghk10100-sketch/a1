# TASK-246: Agent Onboarding Work Incremental Fetch

## Summary
Agent 목록 `Load more` 도입 이후, 온보딩 워크 카운트(`pending + verified_unassessed`)를 목록 전체 재조회하는 비용을 줄이기 위해 증분 조회로 바꾼다.

## Scope
In scope:
- Agent Profile에서 온보딩 워크 카운트 로직을 증분 조회로 변경
- `load more` 시 새로 추가된 agent_id만 batch status API 조회
- `refresh`/재로드 시 캐시를 리셋해 최신 값 재동기화

Out of scope:
- API 변경
- DB 변경
- 다른 페이지 최적화

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual:
  - Agent 목록에서 `Load more` 반복 시 기존 agent들의 온보딩 카운트가 유지되고, 새 agent만 추가 로드된다.
  - `Refresh` 후 카운트가 다시 재동기화된다.
