# TASK-327: Docs Sync and Contract Freeze

## Summary
Desktop runtime/claim lease/smoke/packaging 변경사항을 문서(SPEC/EVENT/README/BACKLOG)에 동기화해 구현 상태와 운영 가이드를 일치시킨다.

## Scope
- `docs/SPEC_v1_1.md` 구현 상태 반영
- `docs/EVENT_SPECS.md` run lease/desktop runtime 운영 이벤트 명시
- `README.md` 실행/복구/패키징/smoke 가이드 업데이트
- `BACKLOG.md` 완료 단계 업데이트

## Out of Scope
- 신규 기능 구현
- 이벤트 모델 breaking change

## Acceptance
1. 문서 내 엔드포인트/용어/상태값 불일치 0
2. `pnpm -r typecheck`
3. `pnpm -C apps/web test`
4. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
