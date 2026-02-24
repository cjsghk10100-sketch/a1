# APP_INTEGRATION_CONSENSUS_FP_V1

## Scope
pipeline_manager ↔ app integration operating consensus (v1)

## Canonical Keys
- `status`
- `approve`
- `promote|demote`
- `incident_code`

## 1) Core Facts (First Principles)
1. 목적은 자동화 자체가 아니라 **통제 가능한 실행 + 증거 축적 + 학습 루프**다.
2. `pipeline_manager`는 **상태 전이 관리자(운영 심장)**이고, 앱은 **통제/가시화 인터페이스**다.
3. 진실 원천은 설명이 아니라 **로그·증거·상태 파일(incident/rollback 포함)**이다.

## 2) Hard Constraints
1. 기본 모드는 **dry-run** 고정. real-run은 명시 플래그 + 승인 무결성(승인자/시각/근거) 필수.
2. 승격은 `EVIDENCE/EVAL/LEARN` + 출처/경로 검증 **ALL PASS**일 때만 허용.
3. 실패 시 즉시 demote/rollback + `incident_code` 기록. 내부 추론/중간 로그는 사용자 비노출.

## 3) Immediate Actions
1. CLI/API 규약 고정
   - CLI: `--dry-run` 기본, `--real-run` 명시 시만 이동/반영
   - 최소 인터페이스: `status`, `approve`, `promote|demote`
2. 검증 함수 우선 구현
   - `check_approval_integrity()`
   - `check_evidence_schema()`
3. 로그 의무화
   - `memory/incidents/*` : 실패 코드/사유
   - `rollback/*` : 되돌림 경로/사유

## 4) SLA & Escalation
- Approval: 24h 초과 시 에스컬레이션
- Evidence review: 12h 초과 시 에스컬레이션
- SLA 반복 초과 건은 incident 누적 후 demote 우선

## 5) Governance
- 본 문서는 앱 연동 v1 운영 합의문(참조 SSOT)이다.
- 상위 규범 충돌 시 `memory/ops/COMMON_CONSTITUTION_V1.md` 우선.
