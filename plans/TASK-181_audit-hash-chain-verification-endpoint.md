# TASK-181: Audit Hash-Chain Verification Endpoint

## Summary
- 감사 무결성 운영성을 위해, 이벤트 해시 체인을 서버가 재검증하는 read endpoint를 추가한다.
- room/workspace stream 기준으로 해시 링크와 재계산 해시 일치 여부를 반환한다.

## Scope
In scope:
- API read endpoint 추가:
  - `GET /v1/audit/hash-chain/verify`
  - query: `stream_type`, `stream_id`, `limit` (optional)
  - 기본값: 현재 workspace의 workspace stream
- 검증 로직:
  - `prev_event_hash` 링크 일치
  - `event_hash` 재계산 일치
  - 최초 불일치 위치 반환
- 계약 테스트에서 endpoint 검증 추가

Out of scope:
- DB schema 변경
- 이벤트 쓰기 로직 변경

## Files
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/audit.ts` (new)
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/index.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_audit_hash_chain.ts`

## Acceptance
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api exec tsx test/contract_audit_hash_chain.ts` 통과
- 테스트에서 `valid=true`, `checked >= 3`, `first_mismatch=null` 확인
