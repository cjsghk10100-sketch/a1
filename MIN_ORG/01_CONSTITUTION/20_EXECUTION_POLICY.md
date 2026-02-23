# EXECUTION POLICY (v0.2)

Runtime 적용본(SSOT): `memory/ops/EXECUTION_POLICY_V1.md`

## 목적
에이전트 조직의 모든 작업이 8단계 루프를 완주하도록 강제한다.

## Core Loop
`Goal → Portfolio → Approval → Execute → Evidence → Eval → Learn → Promote/Demote`

## 절대 규칙
- 승인 없이는 실행 금지
- 증거 없이는 완료 금지
- 단계 생략 금지
- SSOT 충돌 시 즉시 반려

## 승인 레벨
- L0: 무부작용(읽기/조회) — 승인 없이 가능
- L1: 경미(로컬 파일 생성/로그) — 자동 승인 가능
- L2: 금전/주문/포지션 변경 — 사람 승인 필수
- L3: 비가역 실행 — 사람 + 2단계 확인 필수

## 실행 전 체크
- 입력값 검증
- 리스크 한도 확인
- 실행 환경 스냅샷 기록
- 킬스위치 작동 확인

끝.
