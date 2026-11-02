# 은행 연결 A5·A6 개발·검증 안내

## 1. 어디까지 실제로 연결하는가

```
Chromium PC 화면
  → Next.js BFF (실제 로그인 세션·CSRF·HttpOnly proof)
  → NestJS API (실제 일회용 JWT·권한 검증)
  → PostgreSQL (실제 최소 권한·상태 전이·암호문 저장)
  ↔ 합성 은행 공급자 (A5에서만 가짜)
```

A5는 앱 내부의 전체 경로를 검증하는 단계다. 은행 페이지와 토큰 교환 공급자만 가짜이며,
BFF/API 성공 응답을 가로채서 만들어 내지 않는다. 로그인 제공자는 기존 합성 IdP를 재사용한다.
따라서 A5 통과는 **금융결제원 서버 접속·실제 계좌 연결·거래 수집 성공**을 뜻하지 않는다.

일반 로컬 앱과 배포 앱의 은행 연결은 계속 비활성이다. 전용 테스트 실행기만 활성화한다.
별도 스크립트가 테스트 DB를 만들고 테스트 서버를 실행한 후, 서버가 종료되면 자신이 만든 DB를 정리한다.

## 2. 실행 방법

Node 22.15.1, pnpm 11.9.0, 로컬 PostgreSQL 테스트 인스턴스가 필요하다.
기존 `tests/database` 준비 절차에서 만든 `account_book_test` 제어 DB만 허용한다.
Supabase URL이나 운영 DB 주소를 여기에 넣으면 안 된다.

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm --filter @account-book/e2e test:bank
```

코드의 `account-book-e2e-only`는 공개 가능한 합성 로컬 테스트 비밀번호다. 운영 비밀번호로 쓰지 않는다.
이 테스트는 로컬 테스트 클러스터의 `app_api`, `app_session_bff` 역할 로그인 설정을 준비하므로,
그 클러스터를 실제 데이터용으로 겸용하지 않는다.

테스트 포트는 IdP 4510, API 4511, HTTPS 웹 4512다. 웹은 기존 `.next`를 공유하므로 같은
작업 폴더의 dev 서버를 잠시 종료하고 실행한 뒤 원래 서버를 다시 실행한다. 테스트 DB가 이미
있으면 덮어쓰지 않고 중단한다. 원인을 확인하지 않은 강제 삭제·연결 강제 종료는 하지 않는다.

## 3. 각 파일의 역할

| 위치 | 역할 |
|---|---|
| `tests/e2e/bank/run.ts` | DB 준비 → Playwright → 테스트 서버 종료 → DB 정리 순서 보장 |
| `tests/e2e/bank/playwright.config.ts` | 기존 core E2E 설정을 재사용하고 은행 전용 서버 진입점 선택 |
| `tests/e2e/core/setup.ts` | `bank=true`일 때 은행 migration과 BFF 최소권한 계정 추가 |
| `apps/api/src/bank-connections/testing/e2e-guard.ts` | 테스트 전용 API가 다른 환경에서 시작되지 못하게 검사 |
| `apps/api/src/bank-connections/testing/e2e-server.ts` | 실제 Nest 모듈·DB·JWT를 유지하고 은행 공급자만 교체 |
| `apps/web/src/server/bank-connections/e2e-runtime.ts` | 서버 설정이 정확한 폐기용 조합일 때만 테스트 인가 URL 허용 |
| `tests/e2e/bank/support.ts` | 실제 로그인, 합성 은행 화면, 실제 CSRF 완료 요청 도우미 |
| `tests/e2e/bank/bank-connection.spec.ts` | 사용자의 클릭과 DB 결과를 함께 검증 |
| `tests/database/support/bank-e2e-database.ts` | 별도 DB 테스트 패키지가 폐기용 검증 연결을 소유 |

가짜 API 서버는 일반 `main.ts`에서 import하지 않는다. 실행하더라도 NODE_ENV=test, 명시 flag,
고정 loopback host/port, 정확한 테스트 DB, 인증 활성화가 모두 일치해야 한다.
BFF 역시 정확한 테스트 IdP/API/DB 조합을 검사하며 비운영일 때만 허용한다.
`BANK_`, `KFTC_` 부모 환경변수는 테스트 자식 프로세스에서 제거한다.

## 4. 왜 proof·state·암호화가 각각 필요한가

1. **state**: 은행에서 돌아온 응답이 우리 앱에서 시작한 요청인지 확인한다. DB에는 해시만 보관한다.
2. **proof 쿠키**: 요청을 시작한 브라우저인지 확인한다. HttpOnly여서 웹 JavaScript가 읽지 못한다.
3. **사용자·세션 결속**: 쿠키를 다른 세션으로 복사해도 요청의 소유권을 얻지 못한다.
4. **claim 전이**: 완료 요청이 동시에 두 번 와도 DB에서 한 번만 코드를 꺼내 교환한다.
5. **AES-GCM 봉투**: 인가 코드·토큰·공급자 사용자 식별자를 DB에 평문으로 남기지 않는다.
6. **고정 결과 URL**: 은행 code/state 대신 불투명 requestId만 웹 결과 주소에 남긴다.

완료 응답을 확신할 수 없으면 자동 재교환하지 않고 상태를 조회한다. 연결 인증 완료 후에도
현재는 잔액·거래가 자동 수집되지 않는다. 이는 후속 조회·동기화 구현 영역이다.

## 5. A6 공식 테스트 전 확인표

2026-10-02 공개 공식 자료 검토 기준이다. 확인되지 않은 내용은 지원하지 않는다는 뜻이 아니라,
이 프로젝트에서 아직 근거를 확보하지 못했다는 뜻이다.

| 항목 | 확인 상태 | 다음 조치 |
|---|---|---|
| Authorization Code 방식 | 공식 OAuth 안내 확인 | 기존 서버 보유 코드 교환 설계 유지 |
| 조회용 권한 `inquiry` | 공식 잔액·거래 조회 안내 확인 | 송금/출금 scope는 요청하지 않음 |
| 서비스 신청·API 키 연결·Callback 사전 등록 | 공식 시작하기 안내 확인 | 개발자 포털의 실제 설정 상태 확인 |
| TEST authorize/token 정확한 URL | 미확인 | TEST 명세/Swagger 확보 |
| authorize query와 token form 필드 | 미확인 | 필수/선택·인코딩·중복 처리 확인 |
| 성공·거절 Callback 필드 | 미확인 | 현재 내부 엄격 parser와 비교 후 공급자 경계 정규화 |
| 토큰 응답·사용자 식별자·만료 필드 | 미확인 | 내부 `BankProvider.exchange` 계약으로 변환 규칙 작성 |
| PKCE 지원·필수 여부, code 유효기간 | 미확인 | 명세 확인 후 지원/비지원 조건을 문서화 |
| localhost/loopback HTTPS Callback 허용 | 미확인 | 등록 정책 확인; 공개 터널을 임의로 만들지 않음 |
| 테스트 응답 데이터 등록 | 실제 포털 미검증 | 서비스의 테스트 정보 준비 |

공식 운영 OAuth URL을 찾았다고 TEST URL까지 검증된 것은 아니다. 지금은 공식 TEST 어댑터를
추정해서 작성하거나 활성화하지 않는다. 로컬 `api.json`/`web.json`에는 은행 설정 항목이 없음을
값 출력 없이 확인했다. 설정 존재 여부 확인은 포털의 키 유효성 검사와 다르다.

## 6. 사용자가 준비할 것과 이후 개발 순서

1. 금융결제원 개발자 사이트/통합포털에서 최신 **오픈뱅킹 이용기관 API 명세서** 또는 TEST OAuth
   Swagger 문서를 확보한다. PDF·문서 파일은 첨부 가능하다. 키·토큰·실제 계좌번호는 제외한다.
2. 테스트 서비스가 이용 중인지, 서비스별 API Key 등록이 완료됐는지 확인한다.
3. 명세의 Callback 허용 정책을 확인한 뒤 은행 전용 Callback 주소를 정한다. Supabase 소셜로그인
   Callback과 은행 OAuth Callback은 다른 용도다. 아직 검증 안 된 주소를 임의로 등록하지 않는다.
4. 개발자가 공식 provider 어댑터, 서버 전용 설정, 응답 검증·timeout·오류 정규화를 TDD로 구현한다.
5. 필요한 키는 채팅이 아니라 지정된 로컬 비밀 설정 또는 플랫폼 secret 관리 화면에 입력한다.
6. 공식 TEST 환경에서 동의 → Callback → 1회 교환 → 암호화 저장 → 실패·재사용 거부를 검증한다.
7. 그 결과를 기록한 뒤 테스트 잔액·거래 조회와 중복 방지 동기화 단계로 넘어간다.

실계좌 이용 자격·심사·운영 계약은 테스트 API 성공과 별개이며 금융결제원 확인이 필요하다.

## 공식 근거

- [금융결제원 개발자 시작하기](https://developers.kftc.or.kr/dev/starter/starter)
- [OAuth 안내](https://developers.kftc.or.kr/dev/openapi/open-banking/oauth)
- [공식 사용자인증 안내 — 운영 경로](https://openapi.kftc.or.kr/openapi/openbanking/userAuth)
- [잔액조회](https://developers.kftc.or.kr/dev/openapi/open-banking/balance)
- [거래내역조회](https://developers.kftc.or.kr/dev/openapi/open-banking/transaction)
