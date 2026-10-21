# Android 의존성 보완 계획

범위: Android 첫 클라이언트 기반 이후의 의존성 보완. iOS·DB·PC 제품 기능은 변경하지 않는다. 혼합된 기존 미커밋 변경은 보존한다.

## 판단과 변경 파일

- `decode-uri-component@0.2.2`는 Expo Router의 query-string 경로에 있다. 공식 수정판 0.5.0은 ESM이므로 기존 CommonJS 호출과의 호환 확인이 필요하다.
- query-string 전체를 9.x로 교체하면 Expo Router의 named export 사용이 깨질 수 있다. 기존 7.1.3의 API는 유지하고 decoder만 한정 교체하며 default import 호환 한 줄을 pnpm 패치로 관리한다.
- 변경: `pnpm-workspace.yaml`, 생성된 `pnpm-lock.yaml`, `scripts/workspace-policy.test.mjs`, 신규 `patches/query-string@7.1.3.patch`, 신규 `apps/mobile/tooling/router-query.test.cjs`, 모바일 README와 상태 기록.
- node-forge·braces는 공식 공지상 수정판 없음. 개발 도구/실행 코드의 도달성을 구분하고 미해결로 기록한다. 감사 예외 등록이나 자체 암호 알고리즘 수정은 하지 않는다.

## 실행·검증 순서

- [x] 포함된 Navigation 코어에서 URI RED를 확인하고 실제 Expo fork의 별도 호환 시험을 추가했다. 두 경로의 다름은 독립 리뷰로 발견·반영했다.
- [x] 취약 버전에서 RED 확인 후 버전 한정 override와 최소 호환 패치를 적용했다.
- [x] 모바일 테스트·타입 검사·Android 번들 및 프로젝트 전체 verify를 실행했다. 추가 fork 시험 후 마지막 전체 테스트 결과는 상태 기록에 남긴다.
- [x] 재감사와 node-forge·braces 코드 경로 추적을 기록했다. 공식 수정판 없는 2건은 미해결이다.
- [x] 변경 범위 독립 리뷰의 테스트 경로 지적을 보완했다. PC Playwright18개, 최종 전체 테스트2,009개·lint 통과. MD와 Notion 최상위/04/07을 갱신하고 다시 읽기로 확인했다.

## 실패 조건과 제한

- 모듈 형식 오류, 한국어/배열 파싱 변화, 번들 실패가 있으면 교체 완료로 판단하지 않는다.
- JS 번들 성공은 APK/실기기 검증이 아니다. Android SDK/JDK/연결 기기 준비와 실제 HTTPS 로그인은 별도 게이트다.
- autoplan이 참조하는 plan-ceo-review/plan-eng-review/plan-devex-review 파일이 지정 경로에 없어 전체 파이프라인은 미수행이다. 설치된 review 체크리스트와 명시적인 호환/보안/회귀 검증으로 대체하며 완전한 autoplan 통과를 주장하지 않는다.
- 보안 검사는 AI 보조 검토이며 전문 보안 감사·침투테스트를 대체하지 않는다.
