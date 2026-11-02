# 웹 BFF: 화면과 Nest API 연결을 이해하기

## 왜 중간 서버가 있나요?

브라우저에는 DB 비밀번호와 서버 JWT 서명 키를 줄 수 없다. 브라우저가 같은 웹 사이트의 `/api/accounts`를 부르면, Next 서버(BFF)가 로그인 쿠키를 확인하고 Nest API에 대신 요청한다. BFF는 금융 테이블에 직접 접속하지 않는다. 금융 DB 접속 주체는 여전히 Nest의 `app_api`다.

```text
브라우저의 쿠키·입력
  → Next route(허용 동작 선택)
  → CoreController(세션·CSRF·입력 검사)
  → DelegatedApiClient(새 JWT로 정확한 본문 서명)
  → Nest Guard/Controller/Repository
  → PostgreSQL 최소 권한·RLS
  → 응답 계약 검증 → 브라우저
```

## 파일별로 읽는 순서

1. `apps/web/src/app/api/accounts/route.ts`: GET과 POST만 업무에 연결한다. PUT·DELETE·HEAD·OPTIONS 등은 405로 거부한다. route에는 SQL이나 사용자 판단을 넣지 않는다.
2. `server/core/route-adapter.ts`: 매 요청 컨테이너를 만들고 Next의 Promise 형태 경로 매개변수를 기다린다. 생성 실패의 내부 값을 응답에 노출하지 않는다.
3. `server/core/operations.ts`: `accountsCreate` 같은 고정 작업명에 메서드·입출력 계약·scope·내부 주소를 묶는다. 브라우저가 작업 표를 수정할 수 없다.
4. `server/core/core-controller.ts`: 인증 쿠키가 하나인지, 변경 요청이 본인 사이트에서 온 것인지, 입력이 계약에 맞는지 검사한다. 사용자 ID는 요청 본문이 아니라 확인된 세션에서 가져온다.
5. `server/core/http-boundary.ts`: 너무 큰/느린 JSON을 중단하고 안전한 오류와 캐시 금지 헤더를 만든다.
6. `server/http/delegated-api-client.ts`: 실제 전송할 바이트의 복사본을 서명기에 넘겨 서명한 내용과 전송한 내용이 같게 한다. 리다이렉트·캐시·자동 재전송을 허용하지 않는다.

`server/`는 이 가이드에서 `apps/web/src/server/`를 줄인 표기다. 기존 큰 AuthController에 금융 기능을 이어 붙이지 않았다. 세션 확인 함수와 위임 전송기는 기존 것을 공유한다.

## 웹 API 목록

| 브라우저 경로 | 메서드 | 역할 |
| --- | --- | --- |
| `/api/profile` | GET / PATCH | 본인 프로필 조회 / 닉네임 수정 |
| `/api/accounts` | GET / POST | 계좌 목록 / 수동 장부 계좌 생성 |
| `/api/accounts/:id` | PATCH | 계좌 이름 수정 |
| `/api/accounts/:id/archive` | POST | 삭제 대신 보관 |
| `/api/categories` | GET / POST | 분류 목록 / 생성 |
| `/api/categories/:id` | PATCH | 분류 이름·정렬 수정 |
| `/api/categories/:id/archive` | POST | 분류 보관 |

목록은 `includeArchived=true` 또는 `false` 하나만 받는다. 생략하면 Nest가 보관 제외로 처리한다. 계좌 생성은 은행 계좌 연결을 의미하지 않는다. 계좌의 시작 잔액·거래·이체 입력은 아직 후속 API다.

## 예: 계좌 생성 버튼을 누르면

현재 [PC UI](core-web-development.ko.md)는 생성 의도의 UUIDv4 키를 유지하고, 세션용 CSRF 토큰을 받은 뒤 `{ name, kind, idempotencyKey }`를 POST한다. BFF는 이름 공백을 정리하고 허용되지 않은 `ownerId` 같은 필드를 거부한다. 정리한 JSON을 한 번 직렬화하여 `account:write` scope와 함께 보낸다.

Nest는 같은 사용자·키·요청 내용의 재시도에 최초 결과를 재사용한다. BFF가 자동 재시도하는 것은 아니다. 현재 UI는 같은 열린 폼에서 같은 입력을 재시도할 때 키를 유지한다. 폼을 닫거나 새로고침하면 키는 유지되지 않는다.

수정·보관에는 `expectedVersion`을 보낸다. 다른 기기에서 먼저 수정했다면 409가 오므로 화면은 다시 조회하고 사용자에게 충돌을 알려야 한다. 조용히 덮어쓰면 안 된다.

## 보안 및 실패 처리

- POST/PATCH: 세션 결합 CSRF·Fetch Metadata·JSON 필수. Origin이 있으면 공개 canonical origin과 일치해야 하고, 없을 때만 같은 출처의 Referer를 허용한다. 인증용 기존 CSRF 함수는 POST 전용을 유지한다. Next 내부 listener 주소를 공개 Origin과 혼동하지 않는다.
- GET: 세션 확인, 교차 출처 표시 거부. 읽기에서 세션 수명을 늘리거나 토큰을 갱신하지 않는다.
- PC 장부의 `X-Account-Book-User`는 화면을 열었던 사용자와 실제 쿠키 세션의 일치 조건이다. 불일치는 API 전송 전 401로 거부한다. 이 헤더를 권한 근거로 신뢰하지 않고, 모든 사용자 판단은 서버 세션을 따른다. 헤더 생략은 기존 소비자 호환을 위해 허용하지만 이번 웹 UI는 항상 보낸다.
- 접근 토큰 잔여 수명 60초 이하면 401 `AUTH_SESSION_REFRESH_REQUIRED`. `/api/me` 조회에는 기존 한 번의 명시적 refresh 흐름을 사용하며 장부 요청 중 인증 오류는 화면을 잠그고 재로그인을 안내한다.
- 입력은 16 KiB, 출력은 1 MiB 및 목록 1,000개 제한. 압축 응답도 해제된 실제 바이트에 한도를 적용하며 압축된 전송 길이와 직접 비교하지 않는다. JSON 읽기 최대 3초, 내부 fetch 최대 3초. Next maxDuration 10초는 플랫폼의 실행 상한 설정이며 DB/네트워크 모든 지연을 합산한 별도 SLA 보장은 아니다.
- 상류 응답은 공유 스키마·예상 성공 상태·프로필 본인 ID·수정 자원 ID를 확인한다. 모르는 필드/오류/리다이렉트는 고정 502로 숨긴다.
- 모든 응답은 private/no-store. 상류 Set-Cookie·DB 오류·토큰·내부 헤더를 브라우저로 복사하지 않는다.
- 운영 abuse/rate limit, 전체 계정 탈퇴, 실제 OAuth 공급자 검증은 별도 후속이다. 로컬 합성 IdP + 실제 BFF/API/DB의 Playwright 흐름은 [PC 검증 기록](../status/2026-09-30-core-web.ko.md)과 구분한다. BFF 구현만으로 운영 공개를 승인하지 않는다.

## 검사 방식

새 CoreController의 최소 미구현 경계에서 50개 테스트가 실제로 실패함을 확인한 후 구현했다. 이전에는 파일 자체가 없어 import 실패도 있었으며 이를 기능 RED 증거로 대신 쓰지 않았다. UUID 대문자 입력이 거부되는 추가 실패를 재현하여 소문자 내부 경로로 정규화했다. JSON·라우트 회귀 검사는 이미 통과하는 경계도 포함하며 전부를 버그 수정 RED→GREEN으로 부르지 않는다.

외부 HTTP·DB 세션 조회·서명기만 대역으로 교체하고 실제 CoreController, CSRF, Zod, DelegatedApiClient, Next route 모듈을 실행한다. 이 테스트가 실제 은행·브라우저 금융 입력 E2E를 대신하지 않는다. 원격 DB에 시험 거래를 만들지 않았다.
