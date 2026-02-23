# TASK-325: Run Claim Lease/Heartbeat Stabilization

## Summary
Run claim에 lease 토큰/만료/heartbeat를 도입해 외부 엔진 장애 시 stuck run 재클레임을 허용하고, 처리 중 heartbeat/release를 연동한다.

## Scope
- `proj_runs` lease 컬럼 추가 마이그레이션
- `POST /v1/runs/claim` lease 메타 응답 확장
- `POST /v1/runs/:id/lease/heartbeat`, `POST /v1/runs/:id/lease/release` 추가
- 엔진(외부 runner) heartbeat/release 연동
- 계약 테스트 보강 + 신규 엔진 lease 계약 테스트

## Out of Scope
- run/step 이벤트 스펙 구조 변경
- policy gate 의미 변경

## Acceptance
1. `pnpm -r typecheck`
2. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
3. 계약 확인:
   - lease 만료 후 재클레임 가능
   - heartbeat/release 토큰 불일치 시 409
   - complete/fail 이후 lease 필드 정리
