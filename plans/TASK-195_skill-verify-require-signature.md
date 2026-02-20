# TASK-195: Skill Verify Requires Signature (Supply-Chain Hardening)

## 1) Problem
- 현재 `/v1/skills/packages/:packageId/verify`는 해시/manifest만 정상이면 `signature` 없는 패키지도 verified로 승격될 수 있다.
- 공급망 보안 관점에서 서명 없는 패키지 승격은 추적/신뢰 경계를 약화시킨다.

## 2) Scope
In scope:
- verify 시 stored signature 부재 패키지를 실패 처리
- 실패 시 자동 quarantine + 이벤트 기록(기존 TASK-194 패턴 재사용)
- contract test에 `signature_required` 실패 계약 추가

Out of scope:
- 암호학적 서명 검증(공개키/CA 체계)
- 설치(install/import) 단계의 입력 스펙 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 verify 성공 경로(서명 존재 + hash/manifest 정상)는 유지
- 기존 에러 포맷 계약 유지 (`{ error: string }`)
- 실패 패키지는 운영 중 재시도 누락 방지를 위해 quarantined 상태로 전이

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/skillPackages.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_skill_packages.ts`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-195_skill-verify-require-signature.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- contract에서:
  - signature 없는 패키지 verify 시 `400 { error: "signature_required" }`
  - 해당 패키지 `verification_status = 'quarantined'`
  - quarantine reason이 `verify_signature_required`

## 6) Step-by-step plan
1. verify route에 `signature_required` 체크 추가(자동 quarantine 경로 재사용).
2. contract_skill_packages에 unsigned package verify 실패 시나리오 추가.
3. 타입체크 + 전체 계약 테스트 실행.

## 7) Risks & mitigations
- Risk: 기존 클라이언트가 unsigned verify를 사용 중이면 실패 증가.
- Mitigation: 명확한 에러코드(`signature_required`)와 자동 quarantine로 운영자 가시성 확보.

## 8) Rollback plan
- `skillPackages.ts`의 `signature_required` 분기와 test 케이스만 revert하면 이전 동작으로 복귀 가능.
