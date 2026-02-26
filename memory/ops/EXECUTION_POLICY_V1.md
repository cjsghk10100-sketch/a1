# EXECUTION_POLICY_V1

> Runtime SSOT for execution control.

## 0. 목적
본 프로토콜은 모든 작업이 단순 실행에 머물지 않고
**결정→실행→증거→학습 복리**를 만들도록 강제한다.

## 1. 8단계 핵심 루프
`Goal → Portfolio → Approval → Execute → Evidence → Eval → Learn → Promote/Demote`

- 작업 상태의 단일 진실은 앱 이벤트(SSOT)이며, 파일 위치/상태 태그는 이를 보여주는 projection이다.
- 이전 단계 완료 전 다음 단계로 이동 금지.

### Phase 1: 발의 및 격리
1) Goal: 모든 작업 시작 시 1줄 목표 작성
2) Portfolio: 외부 아이디어/입력 수집
- 외부 반입 데이터는 격리 구역에서 시작(잠재 위협 기본 가정)

### Phase 2: 검증 및 실행
3) Approval: 리스크/보안 기준 통과 전 실행 금지
- 실행자는 `approval_id` + `request_hash` 일치 검증 필수
4) Execute: 승인된 건만 실행
- 내부 협업/추론은 비공개 작업 구역에서 처리

### Adapter Role Boundary (고정)
- `pipeline_manager`는 **sync adapter 전용**이다.
- adapter 책임: app→folder projection 렌더링, `_drop` 제한 인입, drift 감지/기록.
- adapter 금지: 승인/승격/강등 판단, 폴더 이동 기반 상태 전이 결정.
- 상태 전이 판단은 앱 API/정책 게이트에서만 수행한다.

### Phase 3: 증명 및 학습
5) Evidence: `EVIDENCE_STANDARD` 충족 여부 기계 검증
- 증거 누락 시 즉시 Execute 단계로 롤백
6) Eval: Goal 대비 KPI로 성공/실패 판정
7) Learn: 1줄 레슨 추출 및 규칙 반영 후보 등록

### Phase 4: 반영
8) Promote/Demote:
- Promote: 장기 메모리/운영 문서 반영 + 대시보드 보고
- Demote: 인시던트 기록 + 보류/폐기/롤백

## 2. 승인 레벨
- L0: 무부작용(읽기/조회) — 승인 없이 가능
- L1: 경미(로컬 파일 생성/로그) — 자동 승인 가능
- L2: 금전/주문/포지션 변경 — 사람 승인 필수
- L3: 비가역 실행(삭제/권한변경/배포/키변경) — 사람 + 2단계 확인 필수

## 3. 절대 제약
1) 단계 생략 금지
2) 승인 없는 고위험 실행 금지
3) 증거 없는 완료 금지
4) SSOT 충돌 시 즉시 반려
5) 사용자 보고는 최종 결정(Promote/Demote) 중심으로 간결하게

## 4. 입력 처리 표준
- 문서 입력: 텍스트 추출 우선, 실패 시 OCR
- 웹 입력: `markdown.new` 우선, 실패 시 fallback
- 내부망/로그인 필요/민감 데이터 페이지는 `markdown.new` 경유 금지
- 수집 결과는 원본 URL/변환 URL/수집시간/폴백 여부를 함께 기록
