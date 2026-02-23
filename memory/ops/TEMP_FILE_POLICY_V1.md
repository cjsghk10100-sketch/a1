# TEMP_FILE_POLICY_V1

목적: 임시 파일을 한곳에서 관리해 탐색 비용/누락/중복을 줄인다.

## 경로 표준
- `tmp/inbox/` : 유입 원본
- `tmp/work/` : 가공/실험 중간 산출물
- `tmp/export/` : 최종 전달 직전 산출물
- `tmp/archive/YYYY-MM/` : 단기 보관

## 규칙
1. 임시 파일은 `tmp/` 밖에 두지 않는다.
2. 확정본만 `memory/`, `references/`, `MIN_ORG/`로 승격한다.
3. 주 1회 `tmp/archive` 기준 정리(불필요 파일 제거)한다.
4. 민감 데이터는 임시 저장 최소화, 필요 시 즉시 정리한다.
