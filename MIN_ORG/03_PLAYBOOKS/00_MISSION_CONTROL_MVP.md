# 00_MISSION_CONTROL_MVP

목적: 앱 실행을 빠르게 하는 것이 아니라, **승인 → 실행 → 증거**를 강제해
반복 가능한 운영 품질(재현/감사/복구)을 확보한다.

---

## 1) 미션 컨트롤이란?
미션 컨트롤은 "앱 런처"가 아니라 다음 4가지를 강제하는 운영 게이트다.

1. 승인 없는 실행 차단
2. 실행 단위 추적(run_id)
3. 증거 묶음 강제(evidence_id)
4. 실패 시 즉시 중단/복구

핵심 질문:
- 누가 승인했는가? (`approval_id`)
- 무엇을 실행했는가? (`request_hash`, `execution_plan`)
- 무엇이 남았는가? (`evidence_id`, logs, metrics)

---

## 2) MVP 범위 (최소 기능)
### A. App Registry
앱/작업 단위를 등록한다.

필수 필드:
- app_id
- name
- command
- owner
- risk_level (L0~L3)
- rollback_plan
- kill_switch
- evidence_schema

예시:
| app_id | name | risk | command |
|---|---|---|---|
| rebalance_bot | Rebalance Bot | L2 | `scripts/rebalance.sh` |
| report_daily | Daily Report | L1 | `scripts/report_daily.sh` |

### B. Approval Gate
실행 요청은 승인 레코드 없으면 거부한다.

필수 조건:
- `approval_id` 존재
- `request_hash` 일치
- 요청 위험 레벨과 승인 레벨 일치

### C. Execution Runner
승인된 요청만 실행한다.

실행 시 생성:
- `run_id`
- 시작/종료 시간
- 실행 환경 스냅샷(버전/설정/커밋)

### D. Evidence Collector
실행 종료 시 증거를 자동 묶음으로 저장한다.

필수 산출:
- `evidence_id`
- raw logs
- inputs/outputs hash
- 핵심 metrics
- rollback 결과(또는 불가 사유)

---

## 3) 표준 실행 플로우 (강제)
1. Request 생성
2. Risk 자동 분류(L0~L3)
3. Approval 검증
4. Execution 실행 (`run_id`)
5. Evidence 저장 (`evidence_id`)
6. 상태 반영 (`state.md` + daily log)

규칙: 5번(Evidence) 누락 시 실행은 실패 처리.

---

## 4) 운영 SOP
### 4.1 실행 전
- 입력값 검증
- 리스크 한도 확인
- 킬스위치 작동 확인
- 롤백 절차 확인
- 문서 입력은 텍스트층 존재 여부를 먼저 판별

### 4.2 실행 중
- 상태 heartbeat 기록
- 임계치 초과 시 자동 중단
- 문서 처리 작업은 텍스트 추출 실패 시 OCR 경로로 자동 전환

### 4.3 실행 후
- Evidence 생성 확인
- 결과 요약/지표 기록
- 실패 시 Incident 파일 생성
- OCR 실패 시 재입력 요청(고해상도 원본/다른 파일 형식) 남김

---

## 5) Incident / Kill Switch
중단 트리거 예시:
- 승인 불일치
- 리스크 한도 초과
- 필수 로그 누락
- 외부 의존성 장애

중단 시 절차:
1. 즉시 중단
2. 안전 상태 복귀(가능 시 롤백)
3. incident 기록
4. 재실행 조건 명시

---

## 6) 일일 운영 체크리스트
- [ ] App Registry 변경 사항 검토
- [ ] 실패 run/incident 점검
- [ ] Evidence 누락 건 확인
- [ ] 리스크 한도 정책 점검
- [ ] 다음 실행 우선순위 업데이트

---

## 7) 외부 인사이트 반영 루프 (자동 성장)
1. 입력 수집: 사용자 공유 링크/문서/트윗
2. 1원칙 분해: 문제/제약/핵심 메커니즘/검증 지표
3. 적용 판정:
   - 운영 개선(자동화/메모리/실수 감소) → 정책·플레이북 반영
   - 투자 ROI 개선 → `memory/reference/ROI_LEARNING_LOG.md` 저장
4. 실행 반영: SOP/체크리스트/크론으로 구체화
5. 검증: 결과 지표 확인 후 유지/수정/폐기


## 8) 웹 수집 표준화 (markdown.new)
- URL 기반 수집은 기본 경로로 `https://markdown.new/<원본URL>` 변환을 우선 시도한다.
- 변환 실패/품질 저하 시 기존 수집 경로(`web_fetch`)로 fallback 한다.
- 결과 저장 시 원본 URL과 변환 URL을 함께 기록해 추적 가능성을 유지한다.
- 1주 A/B 테스트 지표(토큰/지연/오류/핵심 누락률)를 기록하고 기준 충족 시 기본 경로로 승격한다.

## 9) 모델 분업 라우팅 규칙 (실운영)
- Coding: 구현/리팩터/테스트 생성 작업
- Research: 자료 조사/비교/리스크 탐색
- Summarization: 장문 요약/핵심 추출/보고 포맷팅
- Validation: 사실 검증/회귀 점검/증거 교차확인

라우팅 원칙:
1. 작업 시작 시 유형을 위 4개 중 하나로 분류한다.
2. 분류 결과를 실행 로그에 남긴다.
3. 결과물은 반드시 Evidence와 연결한다.
4. 분류가 애매하면 Validation 트랙으로 우선 보낸다.

## 10) 연결 문서
- 공통 헌법: `memory/ops/COMMON_CONSTITUTION_V1.md`
- 실행 정책: `memory/ops/EXECUTION_POLICY_V1.md`
- 증거 표준: `memory/ops/EVIDENCE_STANDARD_V1.md`
- 메모리 SSOT: `memory/ops/MEMORY_RUNTIME_SSOT.md`
- ROI 학습 로그: `memory/reference/ROI_LEARNING_LOG.md`

