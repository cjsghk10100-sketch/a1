# SUPPLY_CHAIN_SECURITY_CHECKLIST_V1

목적: 외부 레포/도구를 운영 루프에 넣기 전, 악성/위험 요소를 구조적으로 검증한다.

## 0) Gate (0순위 보안)
- [ ] `suspicious` 경고 발생 시 기본값은 즉시 보류(quarantine)
- [ ] `--force` 우회 설치는 사용자(민) 명시 승인 없이는 금지
- [ ] 승인/점검 결과는 incident/evidence로 기록

## 1) Intake (기본 식별)
- [ ] 소스 URL/리포지토리/릴리즈 버전 기록
- [ ] 작성자/조직/활성 유지보수 여부 확인
- [ ] 라이선스/법적 제약 확인

## 2) 무결성(Integrity)
- [ ] 릴리즈 아티팩트 해시 검증
- [ ] 태그/커밋 서명(가능 시) 검증
- [ ] 의존성 lockfile 존재 확인

## 3) 정적 점검(Static)
- [ ] install/postinstall/preinstall 스크립트 점검
- [ ] `child_process`, `exec`, `spawn`, 쉘 실행 경로 점검
- [ ] 원격 다운로드/자가 업데이트 코드 점검
- [ ] 권한 과다 요청(파일시스템/네트워크/토큰) 점검

## 4) 동적 점검(Dynamic, Sandbox)
- [ ] 샌드박스에서 실행
- [ ] 비정상 outbound 네트워크 호출 탐지
- [ ] 파일 쓰기/수정 경로 확인
- [ ] 장기 프로세스/백그라운드 행위 확인

## 5) 운영 적합성 판정
- [ ] PASS: 제한된 플레이북에만 도입
- [ ] CONDITIONAL: 기능 축소/권한 제한 후 재검증
- [ ] FAIL: 격리(quarantine) + 도입 금지

판정 규칙:
- ALL PASS 전에는 운영 반입/자동 실행 금지
- 외부 실행 권한은 최소권한으로 시작(읽기/시뮬레이션 우선)
- 첫 도입은 dry-run 우선, real-run은 승인 후 개방

## 6) Evidence 필수
- [ ] 점검 로그 저장
- [ ] 판정 사유 기록
- [ ] 관련 해시/버전/날짜 기록
- [ ] 재검증 일정 등록

## 7) 재검증 주기
- [ ] 주요 버전 변경 시 즉시 재검증
- [ ] 월 1회 최소 재점검
- [ ] `suspicious`/보안 이슈 이력 있는 항목은 주 1회 재점검

## 8) 필수 기록 키
- [ ] source_url
- [ ] version/tag/commit
- [ ] artifact_hash
- [ ] verdict(PASS|CONDITIONAL|FAIL)
- [ ] approver
- [ ] incident_code(해당 시)
