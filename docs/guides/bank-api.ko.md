# NestJS 은행 연결 API — 초급 개발자용 흐름 설명

## 지금 구현한 것과 아직 사용할 수 없는 것

A3는 기존 암호화 도구(A1)와 DB 함수(A2)를 NestJS HTTP 경로에 연결한 단계다.
가상 공급자로 요청 시작 → 은행 Callback → 연결 완료 → 상태 조회를 검증한다.
**실제 금융결제원 테스트 서버 통신, PC 은행 연결 화면, 잔액·거래 수집은 아직 아니다.**

`BankModule`의 `BANK_SERVICE`는 기본 `null`이다. 이는 “설정이 없으면 가짜 성공을
만들지 말고 503으로 닫는다”는 뜻이다. 테스트만 서비스를 명시적으로 주입한다.
환경변수 하나로 가상 은행을 운영 화면에 노출하는 스위치는 만들지 않았다.

## 파일은 왜 나누었나요?

| 파일 (`apps/api/src/bank-connections/`) | 책임 |
| --- | --- |
| `bank-controller.ts` | JWT로 검증된 사용자·세션을 시작/완료/상태 서비스에 전달 |
| `bank-callback.controller.ts` | 은행이 보내는 공개 Callback만 별도로 수신 |
| `bank-service.ts` | 한도 → 저장 → 암호화 → 교환 → 완료 순서 조율 |
| `bank-provider.ts` | 은행 구현이 지켜야 하는 TypeScript 인터페이스 |
| `bank-validation.ts` | 본문/query/공급자 응답을 Zod와 길이 규칙으로 검사 |
| `bank-runtime-safety.ts` | 고정 URL·IP 지문·환경·시간 제한 |
| `bank-repository.ts` | DB 함수를 매개변수 SQL로 호출하고 결과 형태 검사 |
| `bank-database.ts` | 본인 transaction과 익명 Callback transaction 구분 |
| `bank-error.ts`, `bank-error.filter.ts` | 내부 예외를 비밀값 없는 고정 오류로 변환 |
| `bank.module.ts`, `bank.tokens.ts` | 기존 API 풀 재사용, 서비스 기본 비활성 설정 |
| `testing/` | 외부 통신 없는 합성 공급자와 실제 Nest HTTP 테스트 준비 |

“인터페이스”는 공급자에게 요구하는 약속이다. 현재 port는 인가 URL 생성과 코드 교환을
정의한다. 후속 공식 KFTC adapter가 이 약속을 구현하면 서비스의 중복 방지 로직을
다시 작성하지 않아도 된다. 실제 은행 응답 형식을 추측해서 구현하지 않는다.

## 전체 연결 순서

```text
PC/BFF (A4 예정)              Nest API                         DB
   시작 + proof 지문   →  사용자 한도 소비/commit        →  quota
                         state 생성, 요청 저장/commit    →  awaiting_callback
   은행 인가로 이동    ←  requestId + authorizationUrl
은행 Callback          →  IP 한도 소비/commit
                         state 지문 조회, 코드 암호화     →  awaiting_completion
   고정 결과 URL       ←  303 + requestId만
   완료 + proof 지문   →  본인·동일 세션 확인
                         코드 단일 claim/commit          →  exchanging
                         코드 복호화 → 은행 코드 교환 (DB 잠금 밖)
                         응답 검사 → 토큰 암호화/저장    →  connected
   최소 공개 상태      ←  requestId + status
```

`state`와 `proof`는 서로 다른 용도다. state는 은행에서 되돌아온 요청을 찾고,
proof는 최초 시작한 BFF 세션이 연결을 완료하는지 확인한다. API는 proof 원문을
받지 않고 32바이트 SHA-256 지문의 소문자 hex 64자리만 받는다.
BFF의 원문 보관용 HttpOnly/Secure 쿠키와 CSRF 검사는 **A4에서 구현한다**.

## 네 가지 HTTP 경로

| 메서드·경로 | 인증 | 입력 | 정상 응답 |
| --- | --- | --- | --- |
| POST `/v1/bank-connections/kftc/start` | `bank-connection:write` | `{channel:"web",proofDigest}` | 200 `{requestId,authorizationUrl}` |
| GET `/v1/bank-connections/kftc/callback` | JWT 없음, state·IP 한도 검사 | state와 code 또는 error, 정확히 2필드 | 303 고정 HTTPS 결과 URL |
| POST `/v1/bank-connections/kftc/complete` | `bank-connection:write` | `{requestId,proofDigest}` | 200 `{requestId,status:"connected"}` |
| GET `/v1/bank-connections/requests/:requestId` | `bank-connection:read` | 요청 UUID | 200 `{requestId,status}` |

보호 경로는 query를 허용하지 않는다. `userId`, role 같은 추가 본문 필드도 거부한다.
사용자는 브라우저 본문이 아니라 검증된 위임 JWT의 `sub`/`sid`에서 얻는다.
기존 가드가 서명·30초 수명·정확한 권한·메서드/경로/본문 결속·일회용 jti를 검사한다.
DB는 활성 회원과 소유권을 확인한다. **API가 BFF 인증 세션 테이블을 직접 읽어 즉시
폐기 여부를 확인하는 것은 아니다.** A4 BFF가 요청마다 유효 세션을 확인해야 하며
이미 발급한 위임 JWT의 짧은 잔여 수명과 재사용 차단은 별도 방어다.

## 중복 호출과 실패는 어떻게 처리하나요?

`commit`은 해당 DB 작업을 확정한다는 뜻이다. 한도 소비를 시작 요청과 같은
transaction으로 묶으면 시작 요청 실패 시 횟수도 취소된다. 그래서 한도는 먼저
별도 확정한다. 시작은 최근 5분 5회, Callback은 주소 지문별 최근 1분 60회다.
초과하면 429와 `Retry-After`(대기 초)를 반환한다.

완료 요청 두 개가 동시에 와도 DB `claim_exchange`에서 한 개만 인가 코드를 얻는다.
claim의 commit 성공이 확인된 이후에만 은행에 코드를 보낸다. DB 연결이 끊겨 commit
결과를 모르면 성공을 추정하거나 코드를 재교환하지 않는다.

교환은 기본 8초 상한과 `AbortSignal`을 사용한다. timeout 뒤 늦게 성공한 응답도 저장
경로로 넘기지 않는다. 오류·잘못된 응답·저장 실패는 종료 처리하며, 같은 코드를 자동
재시도하지 않는다. 실패 종료 DB 호출마저 실패하면 기존 만료 정리가 회수해야 한다.
정리 함수는 있지만 주기 실행 worker는 아직 없다.

## 어떤 보안 검사를 하나요?

- Callback 원본 query에서 중복·추가 필드, 깨진 인코딩, 제어문자를 거부한다.
  code 최대 4096 UTF-8 바이트, error 최대 128바이트는 앱의 방어 한도다.
- IP는 socket 주소만 사용한다. `X-Forwarded-For`를 믿지 않고 정규화한 주소를 별도
  HMAC 키로 지문화한다. IPv4와 IPv4-mapped IPv6는 같은 한도로 계산한다.
  PaaS 프록시 뒤에서는 여러 사용자가 한 주소로 합쳐질 수 있으므로 검증 없이 활성화하지 않는다.
- 인가 목적지의 HTTPS origin/path와 state를 확인하고 결과 목적지는 서버의 고정 URL로만
  제한한다. 결과 URL에는 requestId 외 code/state/proof/토큰을 넣지 않는다.
- 인가 코드는 요청 UUID, 토큰은 새 연결 UUID에 AES-256-GCM AAD로 결속한다.
  다른 사용자·환경·용도에 암호문을 옮기면 복호화되지 않는다.
- 공급자의 정규화 응답은 엄격한 필드, 미래 만료 시각, refresh token/만료의 짝을
  검사한다. `permissions:["accounts:read"]`는 내부 계약이지 KFTC의 실제 scope가 아니다.
  실제 승인 권한을 이 값에 매핑·검증하는 책임은 공식 adapter에 있다.
- 상태 응답은 두 필드뿐이며 토큰·공급자 사용자 식별자를 내보내지 않는다.
  성공과 오류에 `private, no-store` 및 `no-referrer`를 적용하고 CORS를 열지 않는다.
  API 요청 로그는 비활성이다. 외부 프록시·모니터링의 Callback URL 숨김은 배포 전 별도 검증한다.

## 오류를 읽는 방법

| HTTP/코드 | 뜻 | 다음 행동 |
| --- | --- | --- |
| 400 `BANK_INVALID_REQUEST` | 잘못된 입력, 만료/중복/알 수 없는 Callback | 화면에서 새 연결 흐름 시작 |
| 401 기존 인증 오류 | JWT/회원 검증 실패 | 로그인 상태 재확인 |
| 404 `BANK_REQUEST_NOT_FOUND` | 본인·동일 세션·환경의 요청이 아님 | 다른 요청 정보를 노출하지 않음 |
| 409 `BANK_REQUEST_CONFLICT` | 이미 소비/종료되었거나 교환 중 | 코드 재전송 금지, 상태 확인 |
| 429 `BANK_RATE_LIMITED` | 공유 DB 한도 초과 | `Retry-After` 이후 사용자 동작 |
| 503 `BANK_UNAVAILABLE` | 비활성 설정 또는 은행/DB 처리 불가 | 원인을 공개하지 않으며 무조건 완료 요청 재시도 금지 |

일반 오류 계약의 `retryable`은 장애가 일시적일 수 있다는 뜻이다. 503이라고 일회용
인가 코드 교환을 자동 재시도해도 된다는 뜻은 아니다. A4의 ky mutation 재시도는
꺼 두고 상태 조회/새 연결 안내로 처리해야 한다.

## 다음 개발 순서

1. A4: BFF 세션·CSRF·proof 쿠키, PC 연결 시작/결과/상태 화면과 Playwright 여정.
2. A5: 가상 공급자로 BFF↔API↔DB 전체 연결·보안 회귀.
3. A6: 공식 문서·포털 Callback·테스트 계좌·비밀값·프록시 정책을 확인하고 KFTC 테스트
   adapter 연결. 운영 DB migration은 실행 주체와 적용 대상 확인 후 별도 처리.
4. 연결 이후 잔액·거래 조회/동기화·복구, 알림, 별도 모바일 앱.

실계좌 이용 자격은 금융결제원 확인이 별도다. 테스트 코드 성공을 실계좌 이용 승인이나
운영 배포 완료로 해석하지 않는다. [진행 기록](../status/2026-10-02-bank-api.ko.md)을 함께 읽는다.
