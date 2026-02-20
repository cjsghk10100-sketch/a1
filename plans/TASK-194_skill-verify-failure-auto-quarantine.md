# TASK-194: Skill Verify Failure Auto-Quarantine

## 1) Problem
- 현재 skill package `verify`에서 해시/서명/manifest 검증 실패 시 단순 4xx 반환만 하고 패키지를 격리하지 않는다.
- 악성/변조 가능 패키지가 `pending` 상태로 남아 재시도되며 운영자 시야에서 누락될 수 있다.

## 2) Scope
In scope:
- `/v1/skills/packages/:packageId/verify` 실패 경로에서 자동 quarantine
- quarantine 시 `skill.package.quarantined` 이벤트 기록
- contract test에 verify 실패→자동 격리 케이스 추가

Out of scope:
- 암호학적 서명 스펙 자체 확장
- UI 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 성공 verify 흐름은 유지해야 함
- 이미 quarantined 상태일 때 중복 이벤트를 만들지 않아야 함
- 반환 에러 코드는 기존 계약(`hash_mismatch` 등)을 유지

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/skillPackages.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_skill_packages.ts`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- contract에서:
  - 잘못된 hash로 verify 호출 시 400
  - 해당 패키지 상태가 `quarantined`
  - `skill.package.quarantined` 이벤트 생성

## 6) Step-by-step plan
1. skillPackages route에 auto-quarantine helper 추가.
2. verify 실패 분기(hash/signature/stored invalid)에서 helper 호출 후 기존 에러 반환.
3. contract_skill_packages에 실패 시나리오 추가.
4. 타입체크 + 전체 API 계약 테스트 실행.

## 7) Risks & mitigations
- Risk: 실패 응답 코드/메시지가 바뀌어 클라이언트 호환성이 깨짐.
- Mitigation: 응답 에러 코드는 기존 값을 유지하고 상태 전이/이벤트만 추가한다.

## 8) Rollback plan
- skillPackages route와 contract test 변경만 revert하면 기존 동작으로 즉시 복귀 가능.
