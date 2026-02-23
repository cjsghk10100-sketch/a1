# EVIDENCE_STANDARD_V1

> Runtime SSOT for evidence bundle.
> Source-aligned with: `MIN_ORG/01_CONSTITUTION/30_EVIDENCE_STANDARD.md`

원칙: Evidence Or It Didn't Happen

## 1) Evidence 묶음 필수 구성
- who: 실행자/승인자
- what: 무엇을 실행했나(명령/전략/주문)
- when: 시간(UTC+로컬)
- why: 승인 근거/가정
- inputs: 입력 파라미터 + 해시
- outputs: 결과 + 해시
- logs: 원본 로그(가공 최소)
- metrics: pnl/승률/슬리피지/지연시간 등 핵심 지표
- rollback: 되돌리는 방법 또는 불가 사유

## 2) 연결 규칙
- 모든 Execution은 `approval_id`, `run_id`, `evidence_id`를 가진다.
- UI는 `evidence_id`만으로 재현 가능한 상태여야 한다.
