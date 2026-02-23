# TASK-297: Work Refresh Button Scope Lock

## 1) Problem
Work 화면의 일부 `Refresh`/`Open Inspector` 버튼은 단순히 raw id 존재 여부만 보고 활성화된다. stale 선택값이 남아 있으면 버튼이 눌리지만 실제로는 무효 대상이다.

## 2) Scope
In scope:
- room/run/step scope 기반 파생 id(`scoped*Id`) 추가
- Messages/Steps/ToolCalls/Artifacts Refresh 버튼을 scoped id 기준으로 활성화
- Open Inspector 버튼도 scoped run id 기준으로 활성화

Out of scope:
- API/DB/event 변경
- UI 레이아웃 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. render 시점에 scope 검증된 파생 id를 계산한다.
2. Refresh/Open Inspector 버튼 onClick/disabled를 파생 id 기준으로 교체한다.
3. 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 정상 버튼이 비활성화될 수 있음
- Mitigation: 기존 helper 검증 로직을 그대로 재사용하고 회귀 테스트/타입체크로 확인

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
