---
# 커널 변경 프로토콜

## 1. 커널 변경 정의

아래 중 하나라도 해당하면 커널 변경이다.

- `apps/api/src/contracts/**` 파일 변경
- `apps/api/migrations/**` DDL 변경
- `EVENT_TYPES` 목록 또는 `reason_code` 매핑 변경
- `SUPPORTED_VERSIONS` 정책 변경
- `docs/KERNEL_CHANGE_PROTOCOL.md` 자체 변경

## 2. 버전 태그 규칙

| 태그 | 의미 |
|------|------|
| `[KERNEL-MAJOR]` | 하위 호환 불가 (컬럼 삭제·타입 변경·이벤트 삭제) |
| `[KERNEL-MINOR]` | 하위 호환 가능 추가 (컬럼 추가·이벤트 추가) |
| `[KERNEL-PATCH]` | 문서·주석·인덱스만 변경, 동작 보존 |

## 3. 하위 호환성 원칙

서버는 **현재 버전 + 직전 1개 버전**을 동시에 수용해야 한다.
MINOR/MAJOR 변경 시 `SUPPORTED_VERSIONS = [previous, current]` 형태를 유지한다.

## 4. PR 체크리스트

- [ ] PR 제목에 `[KERNEL-MAJOR|MINOR|PATCH]` 태그가 있는가
- [ ] 이 문서 하단 **Kernel Change Log**에 항목을 append 했는가
- [ ] `schemaVersion.ts` bump + `SUPPORTED_VERSIONS` 갱신을 했는가 (MINOR/MAJOR 시)
- [ ] `contract_kernel_contract.ts` 테스트가 통과하는가

## 5. 롤백 정책

자동화가 아니라 **사람이 판단하고 실행**한다.

임계값 (아래 중 하나라도 초과 시 즉시 revert):
- 배포 후 1시간 내 오류율이 배포 전 대비 +20% 이상 증가
- 배포 후 1시간 내 신규 incident가 10건 이상 증가

롤백 절차:
```bash
git revert <merge_commit_sha>
# hotfix PR 생성, 제목에 [KERNEL-ROLLBACK] 태그
# staging 24시간 관찰 후 재배포
```

## 6. Kernel Change Log

커널 변경 PR마다 아래 테이블에 한 줄 append한다.
(이 문서 자체를 수정하는 PR도 반드시 한 줄 추가)

| 날짜 | 타입 | 요약 | 버전 | PR |
|------|------|------|------|----|
| 2026-02-27 | MINOR | initial kernel version table | 2.1 | #N/A |
| 2026-02-27 | MINOR | work-item lease v0.1 claim/heartbeat/release | 2.1 | #69 |
| 2026-02-27 | MINOR | cron v0 heart with lock fencing and watchdog health | 2.1 | #TBD |
---
