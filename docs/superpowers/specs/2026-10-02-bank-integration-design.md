# A5·A6 은행 연결 통합 검증

## 승인 범위와 목표

사용자 요청: “a5 ~ a6 까지 쭉 진행해봐”. 기존 10-A 승인 설계(A1~A4)를 유지한다.
A5는 실제 Chromium·Next BFF·NestJS·PostgreSQL을 연결한다. 외부 인증 및 은행 공급자만 합성한다.
A6는 공식 TEST 계약과 설정 확인을 진행하되 공개 자료로 확인되지 않은 OAuth 필드를 추정하여 통신하지 않는다.

## 경계

- 현재 feature/bank-state-transitions 격리 작업 폴더에서 진행한다.
- core E2E의 생성/정리 절차를 재사용한다. 고정 loopback 폐기용 DB만 사용하고 기존 DB는 덮어쓰지 않는다.
- BFF와 API는 각각 app_session_bff/app_api DB 역할을 사용한다. JWT·CSRF·세션·RLS를 우회하지 않는다.
- fake 은행 서버는 별도 테스트 진입점에서만 주입한다. 일반 API의 BANK_SERVICE=null은 유지한다.
- 웹의 fake 활성화는 명시 flag, 비운영, fake IdP, 정확한 loopback origin/API/폐기용 DB 조합에서만 허용한다.
- 은행 토큰 키는 API 프로세스에서 무작위 생성한다. BFF·브라우저·로그·Notion에 토큰을 보내지 않는다.
- fake 인가 화면만 브라우저에서 합성한다. BFF/API 요청·응답을 가로채 성공시키지 않는다.
- 운영 DB, 실제 계좌, 송금, 배포, 외부 터널은 범위 밖이다.

## A5 완료 조건

실제 로그인 → 연결 시작 → HttpOnly proof → Callback → 명시적 완료 → 암호화 DB 저장 → 상태 조회를 확인한다.
거절, 중복 Callback, 다른 로그인 세션, 완료 요청 재전송, 실패 시 연결 미저장, 브라우저 토큰 비노출을 검증한다.
환경 격리 테스트는 BANK_/KFTC_ 부모 설정이 자식 테스트 서버에 유입되지 않음을 확인한다.

## A6 계약 확인 게이트

TEST authorize/token endpoint, 요청 query/form, 성공·실패 callback, token 응답·만료, inquiry 권한,
PKCE 지원 여부, code 유효기간, localhost Callback 정책을 공식 명세로 확인해야 한다.
확인 전 adapter를 활성화하거나 실 TEST 성공으로 표시하지 않는다. 사용자에게 비밀 없는 명세서 첨부를 요청했다.

## 비목표

잔액·거래 내역 수집 구현, 자동 동기화, 실계좌 자격 판단은 이번 연결 검증의 완료 조건이 아니다.
