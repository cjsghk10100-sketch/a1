# 10_PROMOTION_DASHBOARD_MVP

목적: 승격 전/후 상태를 사람이 한눈에 확인하도록 시각화한다.

## 1) 화면 구성

### A. Promotion Queue (대기열)
- 항목: proposal_id, 대상 파일, 변경 요약, 리스크 레벨, 제출 시각
- 상태: DRAFT / PENDING_APPROVAL / APPROVED / REJECTED / APPLIED

### B. Diff Viewer (변경 비교)
- before / after 텍스트 비교
- 핵심 변경 하이라이트
- 변경 이유(한 줄)

### C. Evidence Panel
- 근거 링크(트윗/문서/실험 결과)
- 검증 체크리스트 통과 여부
- 관련 run_id / evidence_id

### D. Approval Panel
- 승인자
- 승인 시각
- 코멘트

### E. Timeline
- 생성 → 검토 → 승인/반려 → 반영

## 2) 최소 데이터 필드
- proposal_id
- source_path
- target_path
- summary
- risk_level
- status
- created_at
- approved_by
- approved_at
- evidence_refs[]
- commit_ref

## 3) 운영 규칙
1. PENDING_APPROVAL 상태는 반영 금지
2. APPROVED 상태만 APPLY 가능
3. APPLY 시 commit_ref 필수
4. REJECTED는 사유 필수

## 4) MVP 구현 단계
1. Markdown 대시보드(정적)로 시작
2. 상태 변경은 파일 기반(append-only log)
3. 이후 미션컨트롤 UI로 승격

## 5) 출력 포맷(요약)
- 결론
- 승인 상태
- 다음 액션
