# OpenClaw 크론/파이프라인 재설계 — OUR 적용본 v1.2 (OpenClaw-native)

> **v1.1 → v1.2 변경 요약**
> 1. output_contracts 신설 — 스텝 간 파일 경로 SSOT
> 2. staleness 감지 주체 명확화 — `pipeline-watchdog` 잡 추가
> 3. cutover 조건 판단 로직 코드 수준 명시
> 4. 병렬 실행 설계 — S4/S5/S6 병렬화
> 5. S6 헬스체크 자동화 — 사람 눈 의존 제거
> 6. 스텝 단위 재실행 경로 — idempotency 보장 방법
> 7. CLAWS-lite 인덱스 대용량 대응 — 월별 청크 전략
> 8. Memory Tier vs CLAWS-lite 충돌 분석 — 도입 판단 기준 정립

---

## 0) 현재 적용 상태 (v1.2 기준)

### Phase 1 ✅ 완료
- `nightly-report-2330-kst` 전송 안정화
  - message.send 기반, idempotency + 재시도(2s/5s/12s, 최대 3회)
  - 실패 시 로컬 아티팩트 저장

### Phase 2 ✅ 완료
- `nightly-pipeline-0000-kst` 추가 (S1~S6, 명시적 의존성, CORE 기준 last_success_ts)
- alert_dedup: `nightly-pipeline:<YYYY-MM-DD>:<STEP_ID>:<STATUS>` 키

### Phase 3 🔲 v1.2 신규 (이 문서 적용 범위)
- output_contracts 정의
- pipeline-watchdog 잡 추가 (staleness 감지)
- cutover 조건 판단 로직 자동화
- S4/S5/S6 병렬 실행
- S6 헬스체크 자동화
- 스텝 단위 재실행 경로
- 인덱스 월별 청크 준비

### Cutover 예정
- `nightly-pipeline:cutover-disable-legacy-00xx` (2026-02-21 00:15 KST)
- 조건: 최근 2일 pipeline history가 SUCCESS 또는 PARTIAL_FAILURE

---

## 1) 원칙 (변경 없음)

- **curl/OS crontab 미사용** — OpenClaw cron + message tool이 SSOT
- v1.1 구조적 아이디어(의존성/락/상태/계약/병렬) 채택, 구현 수단은 OpenClaw-native 유지

---

## 2) output_contracts — 스텝 간 파일 경로 SSOT

### 왜 필요한가

S1~S6 각 스텝이 "어디에 쓰고 어디서 읽는지"가 각 스텝 코드 안에 흩어져 있으면,
경로 하나가 바뀔 때 어디가 깨지는지 추적이 안 됩니다.
output_contracts는 이 경로들을 한 곳에서 선언하는 단일 진실 공급원입니다.

### 경로 선언

```
WORKSPACE = ~/.openclaw/workspace/memory

output_contracts:
  # S1 (Constitution rollup) 출력 → S2, S3, nightly-report가 읽음
  constitution_log_jsonl:   $WORKSPACE/constitution/CONSTITUTION_LOG.jsonl
  constitution_log_md:      $WORKSPACE/constitution/CONSTITUTION_LOG.md
  constitution_weekly_md:   $WORKSPACE/constitution/WEEKLY_SUMMARY.md

  # S2 (CLAWS-lite index) 출력 → S3 헬스체크, S5 압축 게이트가 읽음
  episode_index_latest:     $WORKSPACE/episodes/index/episode_index_latest.jsonl
  episode_index_monthly:    $WORKSPACE/episodes/index/episode_index_{YYYY-MM}.jsonl

  # S3 (Health crosscheck) 출력 → nightly-pipeline 최종 상태 판단
  healthcheck_result:       $WORKSPACE/pipeline/healthcheck_result.json

  # S4 (Decisions extract) 출력 → nightly-report, Memory Tier 도입 시 S7
  decisions_jsonl:          $WORKSPACE/decisions/decisions.jsonl

  # S5 (Compress gate) 출력 — 로그만 (파일 이동은 episodes/compressed/)
  compress_log:             $WORKSPACE/pipeline/compress_gate.log

  # S6 (Monthly index roll) 출력 — 월별 청크로 아카이브
  monthly_index_archive:    $WORKSPACE/episodes/index/archive/{YYYY-MM}.jsonl

  # 파이프라인 공통 상태
  pipeline_state:           $WORKSPACE/pipeline/pipeline_state.json
  pipeline_history:         $WORKSPACE/pipeline/history/{YYYY-MM-DD}.json
  alert_state:              $WORKSPACE/pipeline/alert_state.json
  nightly_report_state:     $WORKSPACE/nightly-report-state.json
  nightly_report_failed:    $WORKSPACE/nightly-report-failed.md
```

### 계약 위반 감지

S6 헬스체크(섹션 6)가 output_contracts의 "필수 파일 목록"을 읽어
당일 생성/갱신 여부를 자동으로 확인합니다.
경로가 바뀌면 contracts를 먼저 수정 → 스텝 코드를 수정 순서로 진행.

### 계약 파일 접근 원칙

- 스텝은 output_contracts에 없는 경로를 직접 하드코딩하지 않는다.
- 읽기 전 파일 존재 여부를 확인하고, 없으면 해당 스텝을 SKIPPED가 아닌 FAILED로 처리한다.
- 쓰기는 atomic write(임시 파일 → rename)로 진행해 부분 쓰기 방지.

---

## 3) pipeline-watchdog — staleness 감지 주체

### 문제

`last_success_ts`가 있어도 "누가 25시간 이상 지났을 때 알림을 보내는가"가 v1.1에 없습니다.
파이프라인이 조용히 이틀째 안 돌아도 감지 불가능합니다.

### 해결: pipeline-watchdog 잡 추가

```
job:
  name: pipeline-watchdog
  schedule: 매일 06:00 KST
  role: nightly-pipeline의 staleness를 감지하고 알림 발송
```

**실행 로직:**

```
1. pipeline_state.json 읽기
   - 파일 없음 → [OPS ALERT] pipeline_state.json 자체가 없음

2. last_success_ts 읽기
   - null 또는 없음 → [OPS ALERT] 파이프라인 성공 기록 없음
   - 있음 → 현재 시각과 비교

3. 경과 시간 계산
   - < 25h → 정상 (무음)
   - 25h~48h → [OPS ALERT] level=WARNING, 스텝 실패 내역 포함
   - > 48h → [OPS ALERT] level=CRITICAL, 즉각 확인 요청

4. alert_dedup 적용
   - 키: pipeline-watchdog:staleness:{YYYY-MM-DD}
   - 같은 날 watchdog 알림은 1회만 (재실행해도 중복 방지)
```

**왜 06:00인가:**
00:00 파이프라인이 끝난 후 충분한 여유를 두고 확인합니다.
00:00 파이프라인이 실패하면 00:XX에 실패 알림이 이미 오고,
06:00 watchdog은 "아예 안 돌았거나, 실패 알림 자체도 못 보낸 경우"를 추가로 잡는 안전망 역할입니다.

**nightly-report-state.json도 함께 확인:**
watchdog은 파이프라인뿐 아니라 nightly-report도 확인합니다.

```
watchdog 체크 항목:
  1. pipeline last_success_ts staleness (25h/48h 기준)
  2. nightly-report-state.json 의 last_sent_date가 어제인지 확인
     - 아니면: [OPS ALERT] 야간 리포트 미발송
  3. healthcheck_result.json 의 어제 날짜 결과가 PASS인지 확인
     - FAIL이면 재알림 (dedup 키에 날짜 포함이므로 중복 아님)
```

---

## 4) cutover 조건 판단 로직

### 문제

v1.1에서 "최근 2일 정상이면 레거시 비활성화"인데, 판단 주체와 판단 코드가 없습니다.
사람이 직접 보고 실행하는 구조는 결국 실수하거나 미루게 됩니다.

### cutover 잡 로직 (명시)

```
job:
  name: nightly-pipeline:cutover-disable-legacy-00xx
  schedule: 2026-02-21 00:15 KST (1회성)
  실행 전 조건 검사 → 통과 시에만 레거시 비활성화
```

**조건 판단 코드 수준 명세:**

```
REQUIRED_CONSECUTIVE_SUCCESS = 2
ACCEPTABLE_STATUSES = ["SUCCESS", "PARTIAL_FAILURE"]
CORE_STEPS_REQUIRED = ["S1", "S3"]

function evaluate_cutover_condition():
  history_dir = pipeline/history/
  
  # 최근 2일치 history 파일 읽기
  files = sorted(glob(history_dir + "*.json"))[-2:]
  
  if len(files) < REQUIRED_CONSECUTIVE_SUCCESS:
    return FAIL, "history 파일이 2개 미만"
  
  for file in files:
    state = read_json(file)
    
    # 1. 전체 상태 확인
    if state.status not in ACCEPTABLE_STATUSES:
      return FAIL, f"{file}: status={state.status}"
    
    # 2. CORE 스텝 성공 여부 확인
    for step in CORE_STEPS_REQUIRED:
      step_status = state.steps.get(step, {}).get("status")
      if step_status != "SUCCESS":
        return FAIL, f"{file}: CORE step {step}={step_status}"
    
    # 3. last_success_ts가 해당 날짜에 갱신됐는지 확인
    if state.last_success_ts is null:
      return FAIL, f"{file}: last_success_ts가 null"
  
  return PASS, "조건 충족"

# 실행
result, reason = evaluate_cutover_condition()

if result == PASS:
  # 레거시 6개 잡 enabled=false
  disable_jobs([
    "3e2ad218-14f1-4add-b9f4-4f790f5d19d9",  # mem-constitution-daily-rollup
    "670a5ab4-89d9-4fb4-91a5-6e9b15155ea1",  # claws-lite-index-rebuild
    "589d4ced-9fe9-404a-9eca-0e23ec866b41",  # mem-crosscheck-daily
    "86b1fbf4-0e57-4ad6-a2ab-0eed7d8c849c",  # mem-decisions-daily-extract
    "91aaefc0-9fc9-4fa8-b8de-c85d5e44d022",  # claws-lite-compress-gated
    "c227d910-6ffb-463f-8dce-a31b85880528",  # mem-index-monthly-roll
  ])
  message.send("[OPS] cutover 완료 — 레거시 6개 잡 비활성화")
  
else:
  # 아무것도 비활성화하지 않음
  message.send("[OPS ALERT] [cutover] 조건 미충족 — 레거시 유지\n사유: " + reason)
```

### cutover 롤백 절차

비활성화 후 이상 감지 시:

```
즉시 롤백:
  6개 잡 id를 enabled=true로 되돌리기
  nightly-pipeline의 S1~S6는 계속 실행 (이중운영 상태로 복귀)
  message.send("[OPS ALERT] cutover 롤백 — 레거시 재활성화")

롤백 트리거 기준:
  - cutover 당일 또는 다음날 파이프라인 CORE 스텝 실패
  - watchdog이 staleness WARNING 이상 감지
  - 대표님이 수동으로 판단
```

---

## 5) 병렬 실행 설계 — S4/S5/S6

### 의존성 분석

```
S1 (Constitution rollup)
 └─ S2 (Index rebuild)       ← S1 출력 필요

S3 (Health crosscheck)       ← 독립 (단, S1 출력을 읽으므로 S1 후 실행)
S4 (Decisions extract)       ← 독립 (S1 출력을 읽지만 S2 불필요)
S5 (Compress gate)           ← 독립 (episode raw 디렉토리만 읽음)
S6 (Monthly index roll)      ← 독립 (월초 1일만 실질 작업)
```

### 실행 순서 설계 (v1.2)

```
Phase A (순차, 필수):
  S1 → S2

Phase B (병렬, S1 완료 후):
  S3 ─┐
  S4 ─┤ 동시 실행
  S5 ─┤
  S6 ─┘
  → 모두 완료 대기

Phase C (최종 판단):
  파이프라인 상태 확정
  alert 발송 여부 결정
  pipeline_state.json 갱신
```

### 병렬 실행 시 주의사항

**파일 충돌 방지:**
S3/S4/S5/S6은 서로 다른 output_contracts 경로에 씁니다.
같은 파일을 동시에 쓰는 스텝 조합이 없음을 output_contracts로 보장.

**실패 격리:**
S4가 실패해도 S5/S6은 계속 실행됩니다.
Phase B의 한 스텝 실패가 나머지를 중단시키지 않습니다.

**타임아웃:**
Phase B 전체에 타임아웃 설정 (권장: 10분).
타임아웃 초과 시 아직 실행 중인 스텝을 TIMEOUT으로 처리하고 Phase C 진행.

**병렬 실행 후 CORE 판단:**
Phase B 완료 후 S3 결과를 읽어 CORE 판단 수행.
S3이 FAILED이면 전체를 PARTIAL_FAILURE로 처리 + last_success_ts 미갱신.

### 예상 효과

```
v1.1 순차 (S1→S2→S3→S4→S5→S6):  ≈ 15~25분 (데이터 증가 시)
v1.2 병렬 (S1→S2 → S3/S4/S5/S6): ≈ 8~12분 (가장 느린 스텝에 수렴)
```

---

## 6) S6 헬스체크 자동화

### 문제

v1.1의 체크리스트 섹션 7이 "대표님이 보는 최소"로 설계되어 있습니다.
사람이 매일 확인하는 구조는 놓치는 날이 생깁니다.

### S6를 "헬스체크 자동화 스텝"으로 재정의

v1.2에서 S6는 Monthly index roll이 아니라 **자동화된 헬스체크 스텝**으로 역할을 확장합니다.
(Monthly index roll은 S6 내부의 조건부 서브태스크로 유지)

```
S6 실행 순서:
  1. output_contracts 파일 존재 확인
  2. 데이터 품질 체크
  3. 스텝별 결과 요약
  4. 조건부: 월초이면 Monthly index roll 실행
  5. healthcheck_result.json 갱신
```

### S6 체크 항목 (전체)

```
[파일 존재 확인]
  - constitution_log_jsonl: 오늘 날짜 항목이 1개 이상인가?
  - episode_index_latest: 어제 이후 수정됐는가?
  - decisions_jsonl: 파일이 존재하며 비어있지 않은가?

[데이터 품질 확인]
  - constitution_log_jsonl: 유효한 JSON 파싱 가능한가?
  - episode_index_latest: 총 항목 수가 전날 대비 0 이상인가? (감소 감지)
  - decisions_jsonl: 오늘 날짜 항목이 추가됐는가?

[파이프라인 실행 시간 확인]
  - S1 elapsed_s: 이전 7일 평균 대비 3배 초과 시 SLOW 경고
  - S2 elapsed_s: 동일 기준

[월별 롤링 (조건부)]
  - date.day == 1 이면 실행
  - 전월 episode_index_latest에서 전월 항목만 추출 → archive/{YYYY-MM}.jsonl

[결과 기록]
  healthcheck_result.json:
  {
    "date": "YYYY-MM-DD",
    "status": "PASS" | "FAIL" | "WARN",
    "checks": {
      "constitution_today": true/false,
      "index_updated": true/false,
      "decisions_today": true/false,
      "index_count_regression": false,
      "s1_slow": false,
      "s2_slow": false
    },
    "monthly_roll_executed": true/false,
    "summary": "All checks passed" | "2 checks failed: ..."
  }
```

### S6 결과를 nightly-report가 포함

nightly-report-2330-kst는 output_contracts의 `healthcheck_result`를 읽어
리포트 하단에 "파이프라인 헬스" 섹션을 자동으로 추가합니다.

```
리포트 하단 자동 포함 예시:
  🔧 파이프라인 헬스 (전날 S6 결과)
  └─ status: PASS
  └─ constitution 오늘 항목: ✓
  └─ index 갱신: ✓
  └─ decisions 추가: ✓
```

→ 대표님이 매일 리포트에서 자동으로 확인 가능.
→ 별도로 pipeline_state.json을 직접 열 필요 없음.

---

## 7) 스텝 단위 재실행 경로

### 문제

S2가 실패했을 때 "S2만 다시 실행"하는 명시적 방법이 없습니다.
지금은 파이프라인 전체를 재실행해야 하는데,
이미 성공한 S1이 다시 돌면서 Constitution rollup이 중복 실행될 수 있습니다.

### 두 가지 보장이 필요

**1. idempotency (멱등성): 같은 스텝을 두 번 실행해도 결과가 동일해야 함**

```
S1 Constitution rollup idempotency:
  - 오늘 날짜 항목이 이미 constitution_log_jsonl에 있으면 skip (중복 방지)
  - 구현: rollup.py --date YYYY-MM-DD --skip-if-exists

S2 Index rebuild idempotency:
  - episode_index_latest가 오늘 수정됐으면 skip
  - 강제 재실행이 필요하면 --force 플래그

S3 Health crosscheck:
  - 읽기 전용 스텝. 항상 멱등.

S4 Decisions extract:
  - decisions.jsonl에 append하므로 중복 방지 필수
  - 구현: 오늘 날짜 항목이 이미 있으면 skip

S5 Compress gate:
  - 이미 compressed/에 있는 episode는 재처리 skip
  - 구현: compress.py가 내부적으로 처리 여부 확인

S6 헬스체크:
  - 읽기 중심. monthly roll만 중복 방지 필요
  - 구현: archive/{YYYY-MM}.jsonl이 이미 존재하면 skip
```

**2. step-level 재실행 인터페이스**

```
파이프라인 잡에 재실행 파라미터 추가:
  nightly-pipeline-0000-kst --resume-from=S2
  
  동작:
  1. pipeline_state.json 읽기
  2. --resume-from 이전 스텝들의 상태 확인
     - S2 재실행 시 S1이 SUCCESS인지 확인
     - S1이 SUCCESS가 아니면: [OPS ALERT] S1 미성공 상태에서 S2 재실행 불가
  3. 지정된 스텝부터 실행 (이전 스텝 skip)
  4. pipeline_state.json의 이전 스텝 결과는 유지하고 재실행된 스텝만 갱신
```

### 재실행 시나리오별 절차

**시나리오 A: S2만 실패한 경우**
```
1. pipeline_state.json 확인 → S1: SUCCESS, S2: FAILED 확인
2. nightly-pipeline --resume-from=S2 실행
3. S2만 재실행 → 결과에 따라 S2: SUCCESS로 갱신
4. S2 성공 후 Phase B (S3/S4/S5/S6)는 이미 실행됐으므로 skip
   (단, S3이 FAILED였다면 S3도 함께 재실행)
```

**시나리오 B: S1이 실패해서 S2도 SKIPPED된 경우**
```
1. nightly-pipeline --resume-from=S1 실행 (= 전체 재실행과 동일)
2. S1 성공 후 S2 실행 (idempotency로 S1 중복 실행 안전)
3. Phase B 병렬 실행
```

**시나리오 C: Phase B 중 S4만 실패한 경우**
```
1. nightly-pipeline --resume-from=S4 --only=S4 실행
2. S4만 단독 재실행
3. pipeline_state.json의 S4 결과만 갱신
```

### 수동 재실행 명령 예시 (대표님용)

```
자주 쓰는 재실행 패턴:
  # 전체 재실행 (S1 idempotency로 안전)
  run: nightly-pipeline-0000-kst

  # S2부터 재실행
  run: nightly-pipeline-0000-kst --resume-from=S2

  # S6 헬스체크만 단독 실행 (파이프라인 상태 확인 시)
  run: nightly-pipeline-0000-kst --only=S6

  # dry-run (실제 변경 없이 어떤 스텝이 실행될지 확인)
  run: nightly-pipeline-0000-kst --dry-run
```

---

## 8) CLAWS-lite 인덱스 대용량 대응

### 문제

episode가 수천 개를 넘으면 `episode_index_latest.jsonl` 하나로 관리하면 두 가지 문제가 생깁니다.

- **빌드 시간**: S2 전체 rebuild가 느려짐 (데이터 선형 증가)
- **검색 시간**: index 전체를 스캔해야 하는 쿼리가 느려짐

### 월별 청크 전략 (점진적 도입)

**파일 구조 변경 (지금 잡아두기):**

```
episodes/index/
├── episode_index_latest.jsonl        ← 최근 30일 (검색 기본값, 항상 빠름)
├── episode_index_2025-10.jsonl       ← 월별 아카이브 (S6가 월초에 생성)
├── episode_index_2025-11.jsonl
├── episode_index_2025-12.jsonl
└── episode_index_2026-01.jsonl
```

**S2 rebuild 전략 변경:**

```
현재 (full rebuild):
  모든 episode raw → episode_index_latest.jsonl 전체 재생성
  문제: episode 10,000개 넘으면 몇 분 걸림

v1.2 (incremental rebuild):
  1. 오늘 새로 추가된 episode만 감지 (mtime 기준 또는 체크포인트)
  2. episode_index_latest에 append
  3. episode_index_latest가 30일 초과 항목을 포함하면 → 월별 청크로 이동
  
  트리거:
  - 체크포인트 파일: pipeline/s2_checkpoint.json
    {"last_processed": "2026-02-17", "episode_count": 1234}
  - checkpoint 이후 추가된 파일만 처리
```

**S6 월별 롤링 (확장):**

```
S6 월초 실행 시 (date.day == 1):
  1. episode_index_latest에서 전월 항목 추출
     (date 필드가 전월인 항목)
  2. episode_index_{전월}.jsonl로 저장
  3. episode_index_latest에서 전월 항목 제거
  4. s2_checkpoint.json 갱신

효과:
  episode_index_latest는 항상 최근 30일분만 유지
  → S2 rebuild 시간이 episode 총량이 아닌 최근 30일에만 비례
```

**검색 범위 지정 인터페이스:**

```
query.py 사용 패턴:
  # 최근 검색 (기본값, 빠름)
  query --index latest --keyword "architecture"
  
  # 특정 월 검색
  query --index 2025-11 --keyword "constitution"
  
  # 전체 검색 (느림, 분석용)
  query --index all --keyword "decision"
```

### 마이그레이션 타이밍

**지금 할 것**: 파일 구조 경로만 output_contracts에 정의 (episode_index_monthly 경로 포함).
실제 로직 변경은 S2 rebuild 시간이 **1분을 초과하기 시작할 때** 진행.
기준: S6가 기록하는 S2 elapsed_s가 7일 평균 60초 초과 시.

---

## 9) Memory Tier vs CLAWS-lite 충돌 분석

### 보류 배경

v1.1 Memory Tier(S7)를 보류한 이유가 "CLAWS-lite와 중복/충돌 가능성"이었습니다.
어떤 부분이 겹치는지 구체적으로 분석하고, 도입 판단 기준을 명확히 합니다.

### 기능 비교

```
┌─────────────────┬────────────────────────┬────────────────────────┐
│ 기능            │ CLAWS-lite (현재)       │ Memory Tier (v1.1 S7)  │
├─────────────────┼────────────────────────┼────────────────────────┤
│ 저장 단위       │ episode (대화 단위)     │ 기억 항목 (사실/결정)  │
│ 인덱스          │ episode_index.jsonl     │ memory_index.jsonl     │
│ 검색            │ 키워드 + 날짜           │ 중요도 스코어 + 키워드 │
│ 중요도 판단     │ promote threshold(0.7)  │ importance 스코어(0~1) │
│ 소멸            │ compress gate           │ decay (주간 감쇠)      │
│ 에이전트 참조   │ agentTurn에서 직접 읽음 │ query.py 인터페이스    │
└─────────────────┴────────────────────────┴────────────────────────┘
```

### 충돌 지점 3가지

**충돌 1: 중요도 판단 이중화**
CLAWS-lite의 promote threshold와 Memory Tier의 importance 스코어가
"이 내용이 중요한가"를 각자 독립적으로 판단합니다.
같은 episode가 두 시스템에서 다른 중요도를 부여받으면 에이전트가 혼란스러워질 수 있습니다.

→ **해결 방향**: Memory Tier를 도입한다면 CLAWS-lite의 promote 결과를 importance 스코어의 입력으로 사용. promote됐으면 importance 기본값 0.7에서 시작, 안 됐으면 0.5.

**충돌 2: 인덱스 중복**
episode_index_latest.jsonl과 memory_index.jsonl이 동일한 정보를 다른 포맷으로 저장하게 됩니다.
디스크 낭비보다 "어디서 검색해야 하는가"의 혼란이 더 큽니다.

→ **해결 방향**: memory_index는 episode_index를 대체하지 않고 **상위 추상화 레이어**로 설계. episode_index는 "원본 위치 참조"를 유지하고, memory_index는 importance + decay + 태그 메타데이터만 추가.

**충돌 3: 소멸 정책 이중화**
compress gate (S5)와 decay (Memory Tier)가 둘 다 "오래된/덜 중요한 내용 제거" 역할을 합니다.
같은 episode가 두 정책에 의해 다른 시점에 소멸되면 일관성이 없어집니다.

→ **해결 방향**: compress gate는 "원본 파일 압축", decay는 "인덱스 내 중요도 감쇠"로 역할을 명확히 분리. 원본은 compress gate가 관리, 인덱스 가시성은 decay가 관리.

### 도입 판단 기준

Memory Tier를 도입할 시점은 다음 중 **하나라도 해당할 때**입니다:

```
1. episode가 500개를 넘어서 에이전트가 "어떤 episode가 지금 상황과 관련 있는지"를
   키워드 검색만으로 찾기 어려워질 때
   
2. 에이전트가 같은 결정을 반복하는 패턴이 주 2회 이상 관찰될 때
   (장기기억 부재로 인한 중복 판단)
   
3. decisions.jsonl 항목이 300개를 넘어서 
   "이 결정이 이전에 한 적 있는 결정인가" 확인이 느려질 때
```

현재 상태 확인용 쿼리:
```
episode 수: ls ~/.openclaw/workspace/memory/episodes/raw/ | wc -l
decisions 수: wc -l ~/.openclaw/workspace/memory/decisions/decisions.jsonl
```

---

## 10) 업데이트된 파이프라인 전체 흐름

```
nightly-pipeline-0000-kst (00:00 KST)

Phase A — 순차:
  S1: Constitution daily rollup
      출력 → constitution_log_jsonl, constitution_log_md
      idempotency: 오늘 항목 있으면 skip
      
  S2: CLAWS-lite index rebuild (S1 의존)
      입력 ← episodes/raw/ + s2_checkpoint.json
      출력 → episode_index_latest.jsonl
      idempotency: checkpoint 이후 신규 episode만 처리

Phase B — 병렬 (S1 완료 후):
  S3: Health crosscheck (CORE)
      입력 ← constitution_log_jsonl, episode_index_latest
      출력 → healthcheck_result.json (중간)
      
  S4: Decisions extract
      입력 ← constitution_log_jsonl
      출력 → decisions_jsonl (append, 중복 방지)
      
  S5: CLAWS-lite compress gate
      입력 ← episodes/raw/
      출력 → episodes/compressed/ (조건부)
      
  (S6는 Phase C에서 처리)

Phase C — 순차 마무리:
  S6: 헬스체크 자동화 + 조건부 Monthly roll
      입력 ← output_contracts 전체, pipeline_state(진행 중)
      출력 → healthcheck_result.json (확정), monthly archive (조건부)
      
  상태 확정:
      CORE(S1, S3) 성공 여부 판단
      → SUCCESS / PARTIAL_FAILURE 결정
      → last_success_ts 갱신 여부 결정
      → alert_dedup 키로 실패 알림 발송

pipeline-watchdog (06:00 KST)
  last_success_ts 25h/48h staleness 감지
  nightly-report 미발송 감지
  S6 healthcheck_result FAIL 재알림

nightly-report-2330-kst (23:30 KST)
  입력 ← healthcheck_result.json (전날 S6 결과)
  출력 → message.send (항상 1회, idempotency 보장)
```

---

## 11) 파일 경로 전체 맵 (v1.2 최종)

```
~/.openclaw/workspace/memory/
│
├── pipeline/
│   ├── pipeline_state.json           # 당일 파이프라인 실행 상태
│   ├── alert_state.json              # alert dedup 상태
│   ├── healthcheck_result.json       # S6 헬스체크 결과
│   ├── compress_gate.log             # S5 실행 로그
│   ├── s2_checkpoint.json            # S2 incremental rebuild 체크포인트
│   └── history/
│       └── YYYY-MM-DD.json           # 날짜별 파이프라인 이력 (TTL 30일)
│
├── constitution/
│   ├── CONSTITUTION_LOG.jsonl        # S1 출력 (에이전트 이벤트 누적)
│   ├── CONSTITUTION_LOG.md           # S1 출력 (사람용)
│   └── WEEKLY_SUMMARY.md            # 주간 롤업 출력
│
├── episodes/
│   ├── raw/                          # CLAWS-lite 원본 episode
│   ├── compressed/                   # S5 압축 완료본
│   └── index/
│       ├── episode_index_latest.jsonl   # S2 출력, 최근 30일
│       ├── episode_index_2025-10.jsonl  # S6 월별 아카이브
│       └── ...
│
├── decisions/
│   └── decisions.jsonl               # S4 출력 (append)
│
├── nightly-report-state.json         # T4 idempotency 상태
└── nightly-report-failed.md          # T4 실패 아티팩트
```

---

## 12) 운영 체크리스트 v1.2 (자동화 이후)

### 매일 (리포트에서 확인, 30초)

nightly-report-2330-kst에 자동 포함되는 항목이므로 **별도 확인 불필요**:
- S6 헬스체크 결과 (PASS/FAIL/WARN)
- 어제 파이프라인 상태 요약
- 이상 항목 강조 표시

### 이상 감지 시 (알림 오면 확인)

```
[OPS ALERT] 수신 시:
  1. 알림 키 확인: pipeline-watchdog vs nightly-pipeline:<날짜>:<STEP>
  2. pipeline_state.json 열어 step별 status 확인
  3. 해당 스텝 로그 확인
  4. 필요 시 --resume-from=<STEP>으로 재실행

수동 확인 명령:
  # 파이프라인 상태 요약
  read: ~/.openclaw/workspace/memory/pipeline/pipeline_state.json
  
  # 헬스체크 상세
  read: ~/.openclaw/workspace/memory/pipeline/healthcheck_result.json
  
  # alert_state 초기화 (알림 꼬임 시)
  write: ~/.openclaw/workspace/memory/pipeline/alert_state.json → {}
```

### 주간 (5분)

```
# 지난 7일 파이프라인 이력
read: ~/.openclaw/workspace/memory/pipeline/history/ (최근 7개)
→ 각 파일의 status 확인

# S2 속도 추이 (대용량 대비)
history 파일들의 steps.S2.elapsed_s 추이 확인
→ 7일 평균 60초 초과하면 incremental rebuild 전환 검토

# episode/decisions 수량 확인 (Memory Tier 도입 기준)
ls ~/.openclaw/workspace/memory/episodes/raw/ | wc -l   # 500 초과 시 검토
wc -l ~/.openclaw/workspace/memory/decisions/decisions.jsonl  # 300 초과 시 검토
```

---

## 13) 적용 순서 권장 (v1.1 → v1.2)

**1단계 (즉시, 1~2시간)**: output_contracts 문서화
- 현재 각 스텝에 흩어진 경로를 위 표에 맞춰 확인/정리
- 경로 불일치 있으면 스텝 코드 수정

**2단계 (2026-02-21 이전)**: cutover 조건 로직 구체화
- evaluate_cutover_condition() 함수 잡에 반영
- 조건 판단이 자동으로 돌게

**3단계 (cutover 이후)**: pipeline-watchdog 잡 추가
- 06:00 KST staleness 감지
- nightly-report에 S6 헬스체크 섹션 자동 포함

**4단계 (데이터 증가 후)**: S4/S5/S6 병렬화, S2 incremental rebuild
- S2 elapsed_s가 60초 넘어가기 시작할 때

**5단계 (판단 기준 충족 후)**: Memory Tier 검토
- episode 500개 / decisions 300개 / 중복 판단 패턴 관찰 시

---

_OUR applied version v1.2 — OpenClaw cron + message tool_
_스텝/경로 변경 시 output_contracts(섹션 2)를 먼저 수정하세요._
