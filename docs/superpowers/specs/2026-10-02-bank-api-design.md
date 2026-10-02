# A3 NestJS 은행 연결 API 설계

## 목적과 현재 조건

사용자가 자신의 계좌 조회 연결을 안전하게 시작·완료할 수 있도록 A1 암호화와 A2 DB 함수를 HTTP 경계에 연결한다. 송금·이체 실행은 없다. PC BFF와 별도 모바일이 공유할 서버 책임을 유지한다. 이번에는 가상 공급자로 검증하며 공식 KFTC 호출·키 주입·운영 DB 적용·BFF/UI는 후속이다.

기존 승인 A안(NestJS가 Callback/토큰 소유)을 따른다. 새 하위 시스템이므로 architectural 절차로 설계와 파일별 계획을 작성한다. 일반 작업마다 반복 승인하지 말라는 사용자 지시에 따라 순차 구현+마지막 독립 리뷰를 유지한다. 기존 미커밋 인증/거래/A2 변경은 보존하고 이번에 커밋·푸시하지 않는다.

## 접근법 비교

1. 컨트롤러에서 SQL·암호화·공급자를 한 번에 처리: 파일은 적지만 commit 순서와 오류 경계가 얽힌다.
2. 저장소·서비스·공급자 port·HTTP 경계 분리(선택): 파일은 늘지만 권한/동시성/timeout을 실제 DB와 독립적으로 검사할 수 있다.
3. 별도 마이크로서비스: 배포·비밀값·장애점이 늘어 현재 규모에는 필요 없다.

## 경계와 계약

- POST `/v1/bank-connections/kftc/start`, `bank-connection:write`: strict JSON `{channel:'web',proofDigest:64자리 소문자hex}`. principal의 userId/sessionId만 사용. 응답 `{requestId,authorizationUrl}`; state는 인증 이동 URL에만 존재하며 DB에는 지문만 저장.
- GET `/v1/bank-connections/kftc/callback`: JWT 없는 별도 컨트롤러. state와 code 또는 error 중 하나만, 추가/중복 query 금지. 인가 코드 최대4096 UTF-8 bytes, control 문자 금지. 공급자 error는 최대128 UTF-8 bytes이며 원문을 표시/기록하지 않는다. 미등록/만료/중복 state는 고정400.
- POST `/v1/bank-connections/kftc/complete`, `bank-connection:write`: `{requestId,proofDigest}`. 본인·동일 세션·환경 확인, DB claim commit 성공 뒤에만 공급자 코드 교환.
- GET `/v1/bank-connections/requests/:requestId`, `bank-connection:read`: 동일 사용자·세션 요청의 최소 공개 상태만. code 만료/요청 만료는 DB clock으로 expired로 보이며 정리 주기와 무관하다.
- 은행 HTTP는 고정 오류 코드, no-store/no-referrer, CORS 미허용. Callback 성공은 서버 설정의 고정 HTTPS 결과 URL에 requestId만 붙여303 반환한다. 토큰·code·state·proof를 결과 URL/응답에 포함하지 않는다.

## 트랜잭션과 장애

사용자 동작은 기존 UserDatabase의 활성 회원 검사와 transaction-local 문맥을 사용한다. 익명 Callback은 동일 API 풀을 사용하지만 사용자 우회 run을 제공하지 않고 제한된 두 함수만 호출한다. 제한 사용은 별도 transaction으로 먼저 commit한다. DB/commit 실패 시 fail closed하며 소비를 자동 재시도하지 않는다.

교환: 본인 문맥 조회 → claim commit → 코드 복호화 → provider.exchange(AbortSignal, 기본8초) → 반환 shape/조회 권한/유효시간 검사 → 새 연결 AAD 암호화 → finish commit. 공급자 실패/timeout/잘못된 결과는 fail 처리하고 원문을 숨긴다. claim 결과가 null이면 공급자를 호출하지 않는다. 저장 commit 결과가 불명확하면 성공을 추정하거나 같은 코드를 재전송하지 않는다. 실패 종료도 불가하면 cleanup이 만료시키며 요청은 재교환 불가다.

공급자 port는 `fake | test`만 허용하고 운영 live는 차단한다. 반환은 표준화한 providerSubject/accessToken/refreshToken/accessExpiresAt/refreshExpiresAt/consentExpiresAt와 permissions:['accounts:read']; 이것은 KFTC wire scope가 아니며 실제 매핑은 공식 명세 검증 뒤 어댑터가 담당한다. 토큰 수명은 유효 Date·현재보다 미래, refresh token/expiry는 함께 존재해야 한다. 늦은 응답은 저장하지 않는다.

## 노출과 활성화

주소 지문은 API가 socket remoteAddress를 정규화하여 별도32바이트 HMAC 키로 생성한다. X-Forwarded-For/브라우저 지문 입력을 신뢰하지 않는다. 현재 신뢰 프록시가 없으므로 운영 PaaS 프록시 설정/검증 전 활성화하지 않는다. 시작5분5회, Callback1분60회, 초과429와 Retry-After. 실패 DB는503.

런타임 모듈은 서비스 바인딩을 기본 null로 두어503으로 닫는다. 가상 공급자는 테스트 fixture에서만 주입하며 환경변수 하나로 운영에서 가짜 연결을 만들 수 없게 한다. A6 공식 어댑터·정확한 Callback·프록시 정책·키/URL 검증을 연결하기 전 실제 앱의 은행 기능은 비활성이다. 이는 구현된 HTTP 경계와 공식 테스트 활성화를 구분하는 안전한 중간 상태다.

## 파일·검증 규모

신규 bank-connections 하위 DB 실행기/저장소/서비스/port/검증/HTTP/필터/모듈과 테스트, 공유 scope/오류 계약·AppModule, 실제 DB 통합 시험, 한국어 기록 등 약20~25파일·900~1400줄 예상. 새 의존성 없음. 각 함수 목적·매개변수를 한국어로 설명한다.

실제 PostgreSQL에서 quota commit 유지, owner/session 격리, claim 단일 소비, 암호문 저장/상태를 검사한다. 서비스는 timeout/잘못된 응답/저장 실패/다른 환경을 검사한다. 실제 Nest+Fastify와 서명 JWT로 정확한 scope/body/replay, Callback 입력·headers·지문·redirect를 검사한다. 전체 테스트·DB·타입·lint·API build·PC Playwright smoke와 독립 리뷰 후 Notion을 갱신한다. 가상 HTTP/DB 성공을 금융결제원 연결 성공으로 기록하지 않는다.
