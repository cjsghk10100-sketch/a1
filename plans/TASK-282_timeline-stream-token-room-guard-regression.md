# TASK-282: Timeline Stream Token/Room Guard Regression Lock

## 1) Problem
`TimelinePage`는 SSE callback에서 `streamToken` + `roomSnapshotId`를 함께 검사해 stale callback을 차단한다.  
현재 가드가 인라인으로 중복되어 있어 조건식 회귀가 들어가면 room 전환 후 이전 스트림 이벤트가 UI를 오염시킬 수 있다.

## 2) Scope
In scope:
- Timeline stream callback 가드 조건을 순수 함수로 추출
- onopen/onmessage/onerror/reconnect 경로에서 동일 가드 함수 사용
- 가드 함수 회귀 테스트 추가

Out of scope:
- SSE 프로토콜 변경
- API/DB 변경
- Timeline UI 구조/문구 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/TimelinePage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/TimelinePage.stream-guard.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `TimelinePage.tsx`에 stream callback 허용 판정 함수를 추출(export)한다.
2. 중복된 인라인 체크를 추출 함수 호출로 교체한다.
3. token/room mismatch 회귀 테스트를 추가한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 가드 함수 추출 과정에서 기존 조건이 미세하게 달라질 수 있음
- Mitigation: 기존 비교식과 동일한 조건을 테스트 케이스로 고정

## 8) Rollback plan
- 해당 커밋 revert 시 즉시 원복 가능
- 데이터/마이그레이션 변경 없음
