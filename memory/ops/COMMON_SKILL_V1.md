# COMMON_SKILL_V1

공통 스킬 (v1)

## 목적
모든 작업에서 재사용 가능한 실행 패턴을 표준화한다.

## 입력
- 요청/문제 정의
- 제약 조건(시간, 권한, 리스크)
- 완료 기준(Definition of Done)

## 출력
- 결정 요약
- 실행 결과
- 증거 경로
- 다음 액션

## 표준 실행 절차
1. **정의(Define)**
   - 요청을 1~2문장으로 재정의
   - 성공 기준을 체크리스트로 고정
2. **분해(Decompose)**
   - 작업을 3~7단계로 분해
   - 병렬 가능/순차 필요를 구분
3. **실행(Execute)**
   - 작은 단위로 실행
   - 변경 파일/명령/결과를 기록
4. **검증(Validate)**
   - 완료 기준과 실제 결과를 대조
   - 실패 시 원인/대응을 남김
5. **기록(Log & Learn)**
   - `memory/daily/YYYY-MM-DD.md`에 append
   - 필요시 `memory/state.md`, `memory/failures.md` 갱신

## 의사결정 규칙
- 우선순위: 안전 > 정확성 > 속도
- 불확실하면 가정 명시 후 진행
- 외부 액션은 명시적 확인 후 수행

## 증거 규칙
- “완료” 선언 전 최소 1개 이상 증거 필요
- 증거 유형: 파일 diff, 명령 출력, 테스트 결과, 생성 산출물 경로

## 예외 처리
- 권한 부족: 필요한 권한과 대체 경로 제시
- 정보 부족: 부족 항목 최소 질문으로 수집
- 시간 부족: partial 상태와 잔여 작업 명시

## 연계 문서
- 크론 아키텍처 기준: `references/cron/openclaw_cron_architecture_OUR_v1.2.md`
- 헌법: `memory/ops/COMMON_CONSTITUTION_V1.md`
- 메모리 SSOT: `memory/ops/MEMORY_RUNTIME_SSOT.md`
- 실행 정책: `memory/ops/EXECUTION_POLICY_V1.md`
- 증거 표준: `memory/ops/EVIDENCE_STANDARD_V1.md`
- 병목 감소: `memory/ops/BOTTLENECK_REDUCTION_V1.md`
- 일일 템플릿: `memory/ops/DAILY_DECISION_EXEC_STATUS_TEMPLATE.md`
