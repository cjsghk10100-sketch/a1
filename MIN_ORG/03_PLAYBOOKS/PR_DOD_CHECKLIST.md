# PR_DOD_CHECKLIST

목적: Plan Mode 결과를 실제 구현 PR로 옮길 때 품질/안전 기준을 강제한다.

## 공통 DoD (모든 PR 공통)
- [ ] 변경 목적/범위가 1문단으로 명확하다.
- [ ] 커널 불변 조건 위반이 없다.
- [ ] 테스트(단위/통합/리플레이) 통과 증거가 있다.
- [ ] 롤백 방법이 문서화되어 있다.
- [ ] 운영 영향(리스크/비용/성능)이 기록되어 있다.

## PR-1 DoD (Evidence Manifest)
- [ ] Run당 Evidence Manifest 생성 경로가 있다.
- [ ] manifest에 log/artifact/check/metric 포인터가 포함된다.
- [ ] evidence 없이는 success 종료 금지 로직 유지/강화.
- [ ] Inspector/조회 경로에서 manifest 확인 가능.

## PR-2 DoD (Experiment Object)
- [ ] experiment 생성/조회/상태전이 경로가 있다.
- [ ] goal/hypothesis/success_criteria/stop_conditions 필수.
- [ ] experiment와 runs 1:N 연결이 보장된다.
- [ ] 승인/리스크 한도 연결 필드가 존재한다.

## PR-3 DoD (Scorecard)
- [ ] scorecard 표준 metric 스키마가 고정된다.
- [ ] 계산 책임(어느 단계에서 산출)이 명시된다.
- [ ] baseline 대비 delta 계산이 재현 가능하다.
- [ ] 점수 기반 pass/fail 판정 규칙이 문서화된다.

## PR-4 DoD (Promotion/Demotion)
- [ ] pass 누적 시 승격 제안 경로가 있다.
- [ ] 승격은 승인 절차를 반드시 통과한다.
- [ ] 실패/드리프트 시 강등 경로가 자동 또는 반자동으로 동작한다.
- [ ] 권한 범위(scope) 변화가 감사 로그로 남는다.

## PR-5 DoD (Hardening & Ops)
- [ ] secret redaction이 persist 이전에 강제된다.
- [ ] 공급망 검증 루프와 충돌이 없다.
- [ ] 운영 대시보드/리포트에서 핵심 상태를 확인 가능.
- [ ] 문서(헌법→SOUL→실행파일) 동기화 완료.
