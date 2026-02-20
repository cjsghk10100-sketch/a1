# TASK-182: Egress Hourly Quota Guard (Resource Governor Minimal)

## Summary
- `egress` 정책 평가 전에 principal 단위 시간당 요청 쿼터를 검사하고 초과 시 `deny/quota_exceeded` 처리한다.
- 쿼터 초과는 별도 이벤트(`quota.exceeded`)로 기록한다.

## Scope
In scope:
- `authorize_egress` 경로에 쿼터 검사 추가
  - env: `EGRESS_MAX_REQUESTS_PER_HOUR` (0/미설정이면 비활성)
  - 초과 시 `decision=deny`, `reason_code=quota_exceeded`
- egress route에서 `quota.exceeded` 이벤트 append
- 계약 테스트에 쿼터 초과 케이스 추가

Out of scope:
- DB schema 변경
- 비용($) 단위 추적
- quota warning(80%) 알림

## Files
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/egress.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_egress.ts`
- `/Users/min/Downloads/에이전트 앱/docs/EVENT_SPECS.md`

## Acceptance
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api exec tsx test/contract_egress.ts` 통과
- 테스트에서 3번째 egress 요청이 `quota_exceeded`로 차단됨을 확인
