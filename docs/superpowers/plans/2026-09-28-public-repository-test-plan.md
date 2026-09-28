# 무료·공개 저장소 보호 검증 계획

작성: 2026-09-28, autoplan Eng 검토. 상태: 로컬 실행 승인·검증 수행, 공개/원격 변경 미승인.
브랜치: feature/ci-merge-provenance. 기준 HEAD: 7ecbcc0.
관련 검토: [autoplan](2026-09-27-public-repository-autoplan-review.md).

## 1. 대상과 금지 사항

대상은 저장소 보호·CI·개발자 운영 절차다. 앱 화면과 금융 DB 변경은 없다.
실계좌·운영 secret·고객 자료를 사용하지 않는다. 실제 main에 우회 코드를 push하지 않는다.
무민감 원격 fixture 자원 생성/변경도 별도 승인 후 수행한다.

## 2. 로컬 RED/GREEN

신규 `scripts/security/branch-protection-policy.test.mjs`에서 JSON을 읽어 목표 계약을 검사한다.
기존 null 필수 검사/linear=true가 RED인 이유를 먼저 확인한다. 이후 승인된 값을 적용한다.
실제 app ID를 확보하지 못하면 중단한다. -1(any source), 임의 숫자, null을 배포 가능한 값으로 쓰지 않는다.

| 입력/변경 | 기대 | 검증 형태 |
| --- | --- | --- |
| required_status_checks null/누락 | 정책 실패 | node:test |
| strict=false, context 누락/중복/오타 | 정책 실패 | node:test |
| app_id 누락/-1/0/문자열 | 정책 실패 | node:test |
| 승인된 context와 조회된 양의 app_id | 구조 통과, 원격 ID 증거 별도 | 단위+read-back |
| PR 객체 null 또는 승인 수 0 아님 | A안 계약 불일치 | node:test |
| enforce_admins=false, force/delete=true, linear=true | 정책 실패 | node:test |
| 새 PR 템플릿에서 H/B/C/run/event 누락 | 정책 실패 | workflow-policy.test.mjs |
| free/public 상태를 무조건 미보호라고 표시 | 문서 정책 실패 | workflow-policy.test.mjs |
| 1부모/2부모 간접 병합 fixture | 연관성 검사는 통과 가능; 경로 증명 아님 | merge-evidence.test.mjs |
| PR provenance skipped | guard 통과, 품질 단계 필요 | 기존 테스트 유지 |
| main provenance failure/cancelled/skipped/누락 | 고정 오류 | 기존 테스트 유지 |
| 필수 단계 누락/조건부 건너뛰기/continue-on-error | 정책 실패 | 기존 구조/digest 회귀 |

JSON 테스트가 원격 protection API 적용을 대신하지 않음을 결과에 명시한다.
workflow와 digest 기대값의 동시 악의적 수정은 이 테스트만으로 방지하지 못한다.

## 3. 회귀 명령

저장소에 고정된 Node 22.15.1·pnpm 11.9.0을 사용한다.

```powershell
pnpm test:security-gate
pnpm verify
pnpm --filter @account-book/web test:coverage
```

폐기용 PostgreSQL을 명시적으로 준비한 후 DB·브라우저 검증을 실행한다.
운영 DATABASE_URL을 이 테스트에 넣지 않는다. 인증 분기 coverage 100% 기준을 낮추지 않는다.
원격 CI는 기존 verify·coverage·폐기 DB·브라우저·production audit 단계를 유지한다.

## 4. 승인 후 원격 검증

1. repo ID/visibility/main SHA/기존 보호·rulesets·merge/squash/rebase 설정을 기록한다.
2. 최종 PR head H, base B, 테스트 checkout C, check app ID/name, run ID/event/link를 수집한다.
3. PR merge-ref 검사 C와 원본 H가 다른 정상 경우를 구분한다. 관련 없는 성공 push 실행을 PR 성공으로 대체하지 않는다.
4. 공개 자료 목록+전체 점검+변경분 재검사 뒤 최종 공개 승인을 받는다.
5. 승인된 보호 적용 후 GET read-back으로 target·checks·strict·admins·PR·force/delete·linear를 비교한다.
6. 필수 검사 실패·취소·미실행·stale base가 병합을 막는지 무민감 fixture에서 확인한다.
7. skipped/neutral과 동일 앱·동일 이름 대체 job은 플랫폼이 통과로 볼 수 있다. 실제 결과를 기록하고 본인 검토에서 거부한다. 이를 네이티브 완전 차단 증거로 쓰지 않는다.
8. 정상 PR은 H/B/C와 필수 단계 실행을 본인이 최종 확인한다. 추가 push/base 변경이면 재확인한다.
9. 승인된 정상 병합 뒤 main-provenance와 security-gate의 동일 main SHA 실행을 확인한다.

거부 검증용 fixture는 생성 위치·작은 합성 변경·삭제 여부를 먼저 승인받는다. 실 main은 읽기 확인과 정상 PR 검증만 한다.

## 5. 오류·복구 시나리오

- 401/403/404/422·조회 실패: 미적용/미확인 상태로 중단. 권한·요금제를 임의 변경하지 않는다.
- 보호 read-back 불일치: main 병합 중지, 기대/실제 안전한 필드만 보고.
- 공개 후 보호 적용 실패: 현재 공개 여부와 실패 원인을 즉시 보고, 자동 재비공개가 안전 회수라고 주장하지 않음.
- HTTP 지연/한도/형식 오류: MAIN_MERGE_EVIDENCE_UNAVAILABLE; 동일 이벤트 수동 재실행. 계속 실패하면 조사.
- PR/부모 불일치: MAIN_MERGE_EVIDENCE_REJECTED; 실행 방식 확인, 검사 삭제 금지.
- 공개 대상에 실제 key·금융자료: 원문을 로그/문서에 쓰지 않고 공개 중단·폐기/교체·별도 정리 승인.

## 6. 기록 양식과 완료 판정

날짜, 대상 repo/ref, H/B/C, 실행 ID/URL, 테스트 종류, 통과/실패/미실행, 보호 read-back 요약, 본인 최종 확인을 남긴다.
공개 대상 감사·원격 보호·정상/거부 흐름·독립 검토가 모두 충족되어야 P1을 종결한다.
secret scanning/push protection은 별도 활성 상태 증거가 없으면 미확인으로 남긴다.
이 문서를 작성했다는 사실이나 기존 단위 테스트 성공만으로 공개 안전/보호 활성/베타 가능을 선언하지 않는다.

## 7. 실행 결과 연결

2026-09-28 사용자 승인 후 설정/양식 RED→GREEN, 보안 185개, verify 1,149개, 인증 643개·분기 825/825를 새로 검증했다. 독립 리뷰는 집중 116개를 재실행했다. 실제 DB/E2E·공개 감사·원격 보호는 미실행이다. Windows 기록 도구의 셸 경로 오류와 재검증, 보류 Minor는 [상세 결과](../../status/2026-09-24-ci-merge-provenance.ko.md)에 구분해 기록한다. GitHub Actions app ID 15368의 관측은 출처 확인이며 서버 설정 적용은 아니다.
