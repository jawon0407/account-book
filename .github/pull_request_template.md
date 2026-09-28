## 변경 목적과 범위

- 목적:
- 포함한 변경:
- 제외한 변경:

## 검증 증거

- [ ] 실행한 명령과 통과/실패 개수를 아래에 기록했다.
- [ ] H/B/C와 실행 결과의 대응을 확인했다.
- [ ] head/base/검사 정의가 바뀌면 이전 확인은 무효다.
- [ ] workflow·보안 scripts·package scripts의 최종 diff를 확인했다.

- command:
- result:
- PR head SHA (H):
- base SHA (B):
- CI checkout SHA (C):
- run ID:
- event:
- run URL:
- 최종 본인 확인자/시각:

H는 PR 코드, B는 검사 기준 base, C는 실제 검사 checkout이다. PR merge-ref 검사는 H와 C가 다를 수 있다. 실행 당시 H/B/C와 최신 후보를 대조하고, 검사 단계가 실제 실행됐는지 확인한다. 같은 앱·체크 이름이나 workflow digest만으로 검사 내용이 안전하다고 판단하지 않는다. 이 양식은 사람의 확인 기록이며 자동 승인 장치가 아니다.

## 보안 영향

- [ ] 인증·인가·세션·데이터 경계 변경 여부를 설명했다.
- [ ] 위협 모델 또는 `docs/security/` 변경 필요 여부를 확인했다.
- [ ] 코드, diff, 로그, fixture에 실제 비밀정보나 재무 데이터가 없다.
- [ ] 원격 main 보호와 secret 보호의 실제 상태를 각각 확인했다.

- main 보호 상태/조회 시각/증거:
- secret scanning·push protection 상태/조회 시각/증거:

로컬 목표 JSON은 원격 적용 증거가 아니다. 조회 실패·빈 체크 목록은 성공이 아닌 미확인으로 기록한다. [운영 확인 절차](../docs/security/free-plan-compensating-controls.md)를 따른다.

보안 설명:

## 데이터베이스와 롤백

- [ ] 마이그레이션 없음 또는 마이그레이션·롤백 절차를 기록했다.

마이그레이션/롤백:

## 알려진 잔여 위험

- 위험:
- 수용 또는 후속 조치:
