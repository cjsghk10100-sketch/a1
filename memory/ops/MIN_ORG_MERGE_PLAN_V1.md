# MIN_ORG_MERGE_PLAN_V1

## 목표
MIN_ORG 구조를 현재 운영 OS에 순서대로 병합한다.

## 병합 순서 (고정)
1. `01_CONSTITUTION/00_COMMON_CONSTITUTION.md`
2. `01_CONSTITUTION/20_EXECUTION_POLICY.md`
3. `01_CONSTITUTION/30_EVIDENCE_STANDARD.md`
4. `01_CONSTITUTION/10_USER_MIN.md`
5. `03_PLAYBOOKS/00_MISSION_CONTROL_MVP.md`
6. `02_AGENTS/DeciLog/SOUL.md`
7. `02_AGENTS/OpsExec/SOUL.md`

## 매핑표 (원본 -> 대상)
- `01_CONSTITUTION/00_COMMON_CONSTITUTION.md` -> `memory/ops/COMMON_CONSTITUTION_V1.md`
- `01_CONSTITUTION/20_EXECUTION_POLICY.md` -> `memory/ops/COMMON_SKILL_V1.md`
- `01_CONSTITUTION/30_EVIDENCE_STANDARD.md` -> `memory/ops/EVIDENCE_STANDARD_V1.md` (신규)
- `01_CONSTITUTION/10_USER_MIN.md` -> `USER.md` (+ 필요시 `memory/reference/user-style.md`)
- `03_PLAYBOOKS/00_MISSION_CONTROL_MVP.md` -> `memory/reference/MISSION_CONTROL_MVP.md`
- `02_AGENTS/DeciLog/SOUL.md` -> `SOUL.md` (DeciLog 섹션 병합)
- `02_AGENTS/OpsExec/SOUL.md` -> `SOUL.md` (OpsExec 섹션 병합)

## 병합 규칙
- SSOT 원문은 1곳만 유지하고, 다른 문서는 참조 링크만 남긴다.
- 중복 문장은 삭제하고 의미가 추가되는 항목만 병합한다.
- 사용자 노출 문구는 자연어만 사용한다.

## 진행 상태
- [x] 계획/순서 확정
- [ ] 원본 파일 접근 경로 확인
- [ ] 1~7 순서 병합 실행
- [ ] 충돌/중복 정리
- [ ] 최종 검수
