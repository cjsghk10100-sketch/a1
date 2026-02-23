# OpenClaw Cron Architecture — LEAN Core (v1.2-L)

목적: 크론 운영을 **실행 → 검증 → 학습 → 재발 방지** 루프로 고정한다.

---

## 0) First Principles
1. 결과가 재현되지 않으면 자동화가 아니다.
2. 증거가 없으면 성공으로 처리하지 않는다.
3. 실패는 숨기지 않고 구조화해 다음 실행의 입력으로 쓴다.
4. 같은 실패를 두 번 허용하지 않는다(재발 방지 항목 필수).

---

## 1) 최소 구성 요소 (중복 제거본)
- Scheduler: OpenClaw cron만 사용 (OS crontab/curl 금지)
- Pipeline: 단계형 작업(S1~S6)
- Contracts: 단계 간 입출력 경로 SSOT
- Watchdog: 정체(staleness) 감지 및 경보
- Evidence: run_id + 산출물 + 로그 + 상태
- Replay: 스텝 단위 재실행(idempotent)

---

## 2) 운영 루프 (강제)
1. 실행(Execute)
2. 검증(Validate)
3. 학습(Learn)
4. 재발 방지(Prevent)

### 2.1 실행
- job lock 획득 후 시작
- 각 스텝은 output_contracts 기준 경로만 사용
- 스텝별 상태: SUCCESS | PARTIAL_FAILURE | FAILURE

### 2.2 검증
- 필수 아티팩트 존재 여부 확인
- healthcheck 자동 점검(S6 포함)
- 누락 시 전체 성공 금지

### 2.3 학습
- 실패/지연 원인을 daily 또는 pipeline history에 기록
- 원인 분류: 입력/의존성/정책/환경

### 2.4 재발 방지
- 동일 유형 장애에 대한 가드 추가
- alert dedup 키로 중복 알림 억제
- 재시도 정책/쿨다운/회로차단기 반영

---

## 3) output_contracts (핵심만)
SSOT 파일 한 곳에서만 경로를 선언한다.

필수 계약:
- constitution outputs
- episode index latest/monthly
- healthcheck result
- decisions outputs
- compress log
- monthly roll artifacts

원칙:
- 경로 하드코딩 금지
- 스텝 내부에서 경로 재정의 금지

---

## 4) 잡 설계 기준
- nightly-report (전송 안정화 + 재시도 + 실패 아티팩트 저장)
- nightly-pipeline (S1~S6 의존성 + 병렬 가능한 구간 병렬화)
- pipeline-watchdog (정체 감지/알림)
- cutover job (레거시 중단 조건 자동 판단)

---

## 5) 성공/실패 판정
성공 조건:
- 필수 스텝 완료
- 필수 evidence 생성
- healthcheck 통과

부분실패 조건:
- 비핵심 스텝 실패 + 핵심 산출물 보존

실패 조건:
- 핵심 스텝 실패
- evidence 누락
- healthcheck 실패

---

## 6) 재실행(idempotency) 기준
- 스텝별 재실행 가능해야 함
- 동일 입력 재실행 시 같은 결과 또는 안전한 no-op
- 중복 실행 방지 키 사용

---

## 7) 지표(운영 최소 세트)
- 성공률 (job/step)
- 평균 지연 시간
- 재시도 횟수
- PARTIAL_FAILURE 비율
- staleness 발생 횟수
- 복구 시간(MTTR)

---

## 8) 변경 관리
변경 1건당 반드시 기록:
- 바꾼 이유
- 기대 효과
- 리스크
- 롤백 방법

---

## 9) 체크리스트 (실행 직전)
- [ ] output_contracts 최신 반영
- [ ] lock/dedup 키 충돌 없음
- [ ] retry/backoff 설정 확인
- [ ] healthcheck 자동 경로 연결
- [ ] evidence 저장 경로 확인

---

## 10) 연계 문서
- 상세 원본: `references/cron/openclaw_cron_architecture_OUR_v1.2.md`
- 실행 정책: `memory/ops/EXECUTION_POLICY_V1.md`
- 증거 표준: `memory/ops/EVIDENCE_STANDARD_V1.md`
- 공통 헌법: `memory/ops/COMMON_CONSTITUTION_V1.md`
