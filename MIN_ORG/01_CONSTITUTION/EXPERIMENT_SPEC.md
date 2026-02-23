# EXPERIMENT_SPEC

목적: 실행 1회를 넘어, 가설 검증 단위로 운영 성과를 측정·학습·승격한다.

## 1) 핵심 원칙
- 실험은 반드시 목표(Goal)와 연결된다.
- 실험은 승인 범위(예산/리스크/권한) 안에서만 실행한다.
- 증거 없는 실험 결과는 무효다.
- 평가는 수치화된 스코어카드로만 판정한다.

## 2) 객체 정의
### 2.1 Experiment
- experiment_id
- goal_id
- hypothesis
- method
- budget_cap
- stop_conditions
- success_metrics
- risk_level (L0~L3)
- status (planned/running/paused/done)
- verdict (pass/fail/inconclusive)

### 2.2 Run (실험 하위 실행)
- run_id
- experiment_id
- started_at / ended_at
- execution_plan
- approval_id (필요 시)
- evidence_id
- status

### 2.3 Scorecard
- scorecard_id
- experiment_id
- metric_name -> value
- baseline
- delta
- risk_metrics (MDD, failure_rate, variance 등)
- reproducibility_score
- final_grade (pass/fail/inconclusive)

### 2.4 Lesson
- lesson_id
- experiment_id
- what_worked
- what_failed
- rule_update
- automation_level_change
- requires_approval

## 3) 표준 플로우
1. Goal 연결 확인
2. Experiment 생성
3. 리스크 기반 승인 확인
4. Run 실행
5. Evidence 저장
6. Scorecard 평가
7. Lesson 생성
8. Promote/Demote 결정

## 4) 최소 산출물
- 실험 계획 1개
- 실행 증거 1개 이상
- 스코어카드 1개
- 레슨 1개
- 승격/강등 결정 1개

## 5) 금지 사항
- 목표 없는 실험
- 승인 범위 초과 실행
- 증거 누락 상태의 pass 판정
- 수치 없는 평가를 학습으로 승격
