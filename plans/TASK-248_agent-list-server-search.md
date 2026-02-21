# TASK-248: Agent List Server-side Search

## Summary
Agent 목록 검색을 로컬 필터에서 API 쿼리 기반으로 확장해, 아직 로드되지 않은 에이전트도 즉시 검색되도록 만든다.

## Scope
In scope:
- API: `GET /v1/agents`에 `q` query 지원 (`agent_id`/`display_name` 검색)
- Web API helper: `listRegisteredAgentsPage`에 `q` 전달
- Web: Agent filter 입력 변화 시 서버 재조회(디바운스) + pagination과 결합
- Contract test: `q` 필터 응답 확인

Out of scope:
- DB 인덱스 추가
- 검색 고급 옵션(정렬, fuzzy score)

## Files
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual:
  - Agent filter에 agent_id/display_name 입력 시 서버 재조회로 목록이 갱신됨
  - 검색 상태에서도 `Load more`가 동일 검색 조건으로 동작함
