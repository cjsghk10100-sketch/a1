# TASK-253: Agent Profile Mutation Stale Guards

## Summary
Agent Profile의 mutation 액션(자율성 추천/승인, 격리/해제, 등록, 스킬 임포트) 실행 중 agent가 바뀌었을 때 늦게 도착한 응답이 현재 패널 state를 오염시키지 않도록 stale guard를 추가한다.

## Scope
In scope:
- mutation onClick 핸들러에 `isStillActiveAgent` 기반 가드 적용
- stale 응답일 때 state 반영/로딩 플래그 종료를 건너뛰도록 처리

Out of scope:
- API/DB 변경
- 기능 추가

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
