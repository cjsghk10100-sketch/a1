# DATA_OBJECTS

목적: 운영 OS의 1급 객체를 고정해 Request→Run→Evidence 및 학습 확장 구조를 일관되게 유지한다.

## 1) Core 3 Objects (운영 커널)

### approval_queue (Request)
- 실행 전 승인 대기열 객체
- Request ≠ Execute 경계를 강제
- 핵심 필드(개념): action_type, payload, risk_level, budget_cap, status, approved_by, decided_at

### execution_runs (Run)
- 실제 실행 1회를 기록하는 객체
- approval_queue와 연결되어 실행 책임성을 보장
- 핵심 필드(개념): approval_id, agent, playbook, status, started_at, ended_at, error_code, error_message, evidence_id

### evidence_bundles (Evidence)
- 실행 증거를 묶음으로 보관하는 객체
- 증거 없는 완료를 금지
- 구성 요소(개념): tool_calls, logs, artifacts, checks, metrics, manifest, integrity_hash

## 2) 관계 구조
- approval_queue (1) → execution_runs (N)
- execution_runs (1) → evidence_bundles (1..N)

## 3) 운영 규칙
1. 승인 없는 실행 금지
2. 증거 없는 성공 금지
3. append-only 기록 원칙 유지
4. run 요약과 evidence 원본을 분리 저장

## 4) 학습 확장 객체 (L2~L3)
### experiment
- 가설 검증 단위
- goal_id, hypothesis, method, budget_cap, stop_conditions, success_metrics, verdict

### scorecard
- 수치 평가 객체
- metric_name/value, baseline/delta, risk_metrics, reproducibility_score, final_grade

### lesson
- 학습 산출 객체
- what_worked, what_failed, rule_update, automation_level_change, requires_approval

## 5) 연계 문서
- `MIN_ORG/01_CONSTITUTION/EXPERIMENT_SPEC.md`
- `MIN_ORG/01_CONSTITUTION/PROMOTION_PIPELINE.md`
- `MIN_ORG/01_CONSTITUTION/RISK_POLICY.md`
- `memory/ops/COMMON_CONSTITUTION_V1.md`
