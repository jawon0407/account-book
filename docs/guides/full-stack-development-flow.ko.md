# 가계부 풀스택 개발 흐름 학습 가이드

이 문서는 가계부의 PC 웹, 모바일 앱, BFF, Node API, PostgreSQL이 어떻게 연결되는지 학습할 수 있도록 개발 흐름을 설명한다. 구현 진행 중에는 각 계획의 RED/GREEN 결과, 주요 매개변수, 오류와 보안 판단을 이 문서의 구조에 맞춰 누적한다.

## 1. 전체 요청 흐름

### 1.1 PC 웹 조회

```text
React 화면
  → React Query hook
  → ky
  → Next.js Route Handler
  → BFF controller
  → opaque session 검증
  → 요청에 결속된 delegated JWT 발급
  → Heroku NestJS controller
  → AuthGuard
  → service
  → repository
  → PostgreSQL transaction + RLS
  → 공개 response contract
  → React Query cache
  → 화면
```

브라우저는 Heroku API와 PostgreSQL을 직접 호출하지 않는다. Next.js BFF가 브라우저 세션을 검증하고, 정확한 method·target·body·scope 한 개에만 사용할 수 있는 짧은 수명 위임 JWT를 발급한다.

### 1.2 모바일 조회

```text
React Native 화면
  → React Query hook
  → ky
  → Heroku 모바일 API 경계
  → 모바일 session 검증
  → service
  → repository
  → PostgreSQL transaction + RLS
  → 공개 response contract
  → React Query memory cache
  → 화면
```

모바일은 브라우저 cookie나 Vercel BFF를 사용하지 않는다. 시스템 브라우저와 PKCE로 로그인하고, credential은 iOS Keychain·Android Keystore 기반 secure storage에만 보관한다. 모바일과 웹은 서로 다른 세션 형식을 사용하지만 서버에서 같은 canonical `user_id`로 연결된다.

### 1.3 변경 요청

거래 생성 요청을 예로 들면 다음 순서다.

1. 화면이 문자열 금액, 계좌 ID, 카테고리 ID, 거래일을 수집한다.
2. 클라이언트 계약이 형식만 빠르게 검증한다.
3. 서버가 같은 Zod 계약을 다시 검증한다.
4. 인증 계층이 사용자를 확인한다.
5. service가 비즈니스 규칙과 멱등성을 검사한다.
6. repository가 한 DB transaction을 시작한다.
7. transaction-local `app.user_id`를 설정한다.
8. PostgreSQL 제약과 RLS가 소유권과 무결성을 다시 검사한다.
9. commit 뒤 공개 response만 반환한다.
10. React Query가 거래 목록·계좌·대시보드를 무효화하고 다시 조회한다.

클라이언트 검증은 UX를 위한 것이며 보안 통제가 아니다. 서버 계약, API 인가, DB RLS가 모두 통과해야 저장된다.

### 1.4 위임된 변경 요청: 구현된 경계로 학습하기

아래는 “PC에서 지출 저장 버튼을 누른다”는 학습 시나리오를 실제로 구현·검증한 delegated mutation 경계에 연결한 기록이다. 현재 production 거래 저장 route를 새로 배포했다는 뜻은 아니다. 실제 end-to-end 증거는 test-only `POST /v1/test-mutation`에서 얻었고, hosted 환경 검증은 아직 이 기록으로 대체되지 않는다.

| 항목 | 실제 경계와 증거 |
| --- | --- |
| 사용자 행동 | PC의 지출 저장은 strict public contract를 통과한 거래 객체만 BFF에 보낸다는 시나리오다. 브라우저가 Heroku API를 직접 호출하거나 `userId`를 정하는 흐름은 없다. |
| BFF 입력과 불신 값 | BFF client 입력은 `method`, relative `target`, `contentType`, `body`, 검증된 session의 `userId`·`sessionId`, 최소 `scope`뿐이다. browser `userId`, `Authorization`, cookie, host, browser가 준 request ID는 받거나 전달하지 않는다. |
| 매개변수 출처 | `method`·`target`·`contentType`·`body`·`scope`는 서버 route/use-case와 public contract에서 결정한다. `requestId`는 signer가 새 canonical UUID를 만들고 API는 raw `X-Request-Id`가 하나인지 확인한다. API의 required scope는 controller metadata에서 읽으며 body나 JWT의 임의 role에서 읽지 않는다. |
| canonical bytes | body는 BFF에서 한 번 만든 UTF-8 `Uint8Array`를 재직렬화 없이 signer와 `fetch`에 같은 인스턴스로 전달한다. 실제 matrix의 `{"amount":1200,"memo":"lunch"}`는 30 bytes다. JWT request binding은 이 byte열의 SHA-256, method, query를 정렬한 relative target, 정규화한 `application/json`, server-generated request ID를 줄바꿈으로 연결해 다시 SHA-256 한다. JSON property를 다시 정렬해 “같아 보이는” body를 만들지 않는다. |
| 전송 한계 | mutation body는 비어 있지 않은 JSON이어야 하고 parser와 guard가 같은 32 KiB(32,768 bytes) 상한을 적용한다. BFF→API `fetch`는 3초 `AbortSignal.timeout(3_000)`이며 timeout·network·signer 실패는 고정 unavailable 오류로 처리한다. |
| RED | `pnpm --filter @account-book/api test -- auth.guard.test.ts`는 기존 GET-only guard가 새 POST/PATCH/DELETE binding 세 건을 `AUTH_ACCESS_TOKEN_INVALID`로 거부해 실패했고, 나머지 125 tests는 통과했다. 이후 matrix RED인 `pnpm --filter @account-book/api test -- mutation-boundary.integration.test.ts`는 test-only POST 기본 201이 요구 200과 달라 8개 신규 assertion이 실패하고 기존 134 tests는 통과했다. |
| GREEN | guard focused GREEN은 8 files/128 tests, matrix final GREEN은 `pnpm --filter @account-book/api test`에서 9 files/147 tests였다. matrix는 exact POST 200을 허용하고 JSON으로 유효한 정확히 1 byte 변경, target/query 변경, scope 부족, replay, 만료, duplicate raw headers를 거부하며 32 KiB 초과는 verifier 전에 413임을 확인한다. BFF client test는 signer와 fetch가 같은 body instance를 쓰고 3초 timeout과 header allowlist를 확인했다. |
| 커밋·범위 | contracts `22b5163`, raw parser `5e122c6`·`e81d117`·`15baaf2`, guard `a6d62f6`, BFF client `9fd29e1`·`a91f0b3`, integration matrix `4fbdcbb`·`5c3461f`가 이 증거의 구현 커밋이다. 각 상세 명령·결과는 [인증 보안 테스트 가이드](security-auth-testing.md)에 기록한다. |
| 잔여 위험 | BFF가 침해되면 이미 허용된 최소 scope로 짧은 요청을 만들 수 있다. Platform owner는 hosted Vercel/Heroku secret 배치와 current+previous public-key rotation/removal 증거를 **최초 hosted delegated mutation release 전** 수집하고, Security owner는 같은 기한 전 BFF 침해 대응 훈련을 수행한다. 재검토 조건은 secret/keyset 배치 또는 BFF delegation scope 변경이며 rollout 전에 다시 검토한다. replay fail-closed와 principal+route rate limit은 위험을 완화하지만 제거하지 않는다. |

## 2. 모노레포 책임

| 경로 | 책임 | 넣지 않는 것 |
|---|---|---|
| `packages/contracts` | Zod 요청·응답·오류·내부 API 계약 | DB 연결, React component |
| `packages/database` | DB client와 schema 표현 | HTTP, 화면 상태 |
| `supabase/migrations` | 실제 SQL schema·role·grant·RLS | 런타임 secret |
| `apps/api` | 인증된 금융 use case와 repository | 브라우저 cookie, UI |
| `apps/web` | PC UI, 웹 세션, BFF | 금융 DB 직접 CRUD |
| `apps/mobile` | iOS·Android UI와 모바일 세션 | DB 직접 접근, 웹 cookie |
| `tests/database` | 실제 PostgreSQL role·RLS·transaction | mock DB 성공 테스트 |
| `tests/e2e` | 사용자 관점의 PC·모바일 통합 증거 | 내부 구현 세부 단정 |
| `docs` | 결정·원리·운영·테스트 증거 | 실제 secret·금융 데이터 |

## 3. Contracts-first 원칙

프론트와 백엔드가 동시에 개발되려면 먼저 공용 계약을 고정해야 한다.

```ts
type CreateTransactionInput = Readonly<{
  accountId: string;
  amountKrw: string;
  categoryId: string;
  idempotencyKey: string;
  kind: "income" | "expense";
  memo?: string;
  occurredOn: string;
}>;
```

중요한 판단:

- 금액은 JSON number가 아니라 정규화된 정수 문자열로 전송한다.
- `userId`는 요청에 받지 않고 인증 principal에서 가져온다.
- 수정·삭제는 `expectedVersion`을 요구한다.
- 알 수 없는 필드는 strict schema에서 거부한다.
- 내부 오류 문자열이나 PostgreSQL detail은 공개 contract에 포함하지 않는다.

계약 변경 순서:

1. 잘못된 입력과 정상 입력의 실패 테스트를 작성한다.
2. 테스트가 RED인지 확인한다.
3. 최소 Zod schema와 타입을 구현한다.
4. 계약 테스트를 GREEN으로 만든다.
5. backend와 frontend consumer를 순서대로 연결한다.

## 4. 백엔드 계층

### 4.1 Controller

Controller는 HTTP를 도메인 입력으로 바꾼다.

- route·method
- header·query·path·body schema
- 인증 principal 읽기
- service 호출
- 공개 status와 response

Controller가 SQL을 실행하거나 금액 통계를 계산하지 않는다.

### 4.2 Service

Service는 한 사용자 행동의 비즈니스 규칙을 소유한다.

- 거래 종류와 카테고리 종류 일치
- 이체 양쪽 계좌가 다름
- 동일 멱등성 키의 재요청
- expected version 충돌
- 여러 repository 작업의 원자성 요구

Service는 Fastify `Request`나 React Query를 알지 않는다.

### 4.3 Repository

Repository는 SQL과 DB transaction을 소유한다.

- parameterized query
- transaction-local 사용자 문맥
- cursor 정렬
- atomic update
- RLS와 제약 위반의 안전한 domain error 변환

Repository는 HTTP status나 사용자용 한국어 문구를 반환하지 않는다.

### 4.4 PostgreSQL

PostgreSQL은 마지막 방어선이다.

- `NOT NULL`, `CHECK`, `UNIQUE`
- 사용자 경계를 포함한 복합 FK
- `ENABLE/FORCE ROW LEVEL SECURITY`
- 최소 권한 runtime role
- transaction rollback
- index와 query plan

API 검사만 믿지 않는다. 실수로 repository의 사용자 조건이 빠져도 RLS가 다른 사용자의 행을 차단해야 한다.

## 5. PC 프론트엔드 계층

### 5.1 Route와 page

Page는 URL과 화면 조합을 정의한다. 큰 비즈니스 로직과 HTTP 세부사항을 넣지 않는다.

### 5.2 Domain component

Component는 입력, 표시, 접근성, 로딩·오류 상태를 책임진다.

- `label`, `aria-invalid`, 오류 설명 연결
- 44px 이상 터치 영역
- 키보드 이동
- reduced motion
- 민감정보 없는 성공 알림

### 5.3 Query hook

Query hook은 서버 상태 정책을 한곳에 모은다.

```ts
const transactionKeys = {
  all: ["transactions"] as const,
  list: (filter: TransactionFilter) =>
    [...transactionKeys.all, "list", filter] as const,
};
```

책임:

- query key
- ky 호출
- response parsing
- retry 가능 오류 분류
- mutation 성공 후 invalidation

금융 mutation은 기본적으로 낙관적 화면 반영을 하지 않는다. 서버 commit 성공 뒤 다시 조회한다.

### 5.4 로컬 상태

다음은 React local state로 충분하다.

- dialog 열림
- 선택된 tab
- 작성 중인 form
- 일시적인 filter UI

서버에서 온 거래·계좌·예산을 Zustand에 복제하지 않는다. 서버 상태는 React Query 한 곳에서 관리한다.

## 6. 모바일 프론트엔드 계층

모바일도 contracts와 query 정책을 공유하지만 화면은 React Native로 별도 구현한다.

- Expo Router route
- native input와 keyboard
- safe area
- VoiceOver·TalkBack
- foreground 복귀
- secure storage session
- Android back과 iOS gesture

모바일 query cache는 초기 버전에서 메모리에만 둔다. 앱 재시작 후 서버에서 다시 조회한다. 오프라인 영구 저장은 별도 위협 모델 승인 전까지 구현하지 않는다.

## 7. 주요 매개변수 읽는 법

| 매개변수 | 출처 | 신뢰 여부 | 검증 위치 |
|---|---|---|---|
| `userId` | 인증 principal | 검증 후 신뢰 | BFF/API 인증 + RLS |
| `accountId` | 사용자 입력 | 불신 | contract + 복합 FK + RLS |
| `amountKrw` | 사용자 입력 | 불신 | Zod + service + DB range |
| `occurredOn` | 사용자 입력 | 불신 | ISO date schema + DB DATE |
| `idempotencyKey` | 클라이언트 생성 | 식별값만 신뢰 | UUID schema + DB unique |
| `expectedVersion` | 클라이언트가 본 버전 | 불신 | integer schema + atomic WHERE |
| `cursor` | 서버 발급 후 클라이언트 반환 | 불신 | 서명/형식·범위 검증 |
| `requestId` | 서버 생성 | 신뢰 | canonical UUID 검증 |
| `scope` | route metadata/JWT | 검증 후 신뢰 | BFF signer + API guard |

주석은 “무엇을 하는 코드인지”를 그대로 반복하지 않고, 왜 이 매개변수를 불신하는지와 어떤 불변식을 지키는지를 설명한다.

## 8. 오류 흐름

```text
PostgreSQL/외부 공급자 오류
  → repository의 고정 domain error
  → service의 business error
  → API error filter
  → 공개 error code + fieldErrors
  → BFF가 허용된 공개 정보만 전달
  → query hook이 UI 상태로 매핑
```

사용자에게 표시하지 않는 값:

- SQL과 table 이름
- stack trace
- token·cookie
- request body 원문
- 거래 메모
- DB URL
- provider 응답 원문

사용자에게 표시할 수 있는 값:

- 고정 공개 오류 코드
- 필드별 검증 위치
- 다시 시도 가능 여부
- 일반적인 한국어 안내

## 9. TDD 학습 기록

각 구현 task에는 다음 표를 남긴다.

| 항목 | 기록 내용 |
|---|---|
| 행동 | 사용자가 무엇을 시도하는가 |
| 입력 | 신뢰·불신 매개변수 |
| RED | 어떤 실패를 먼저 재현했는가 |
| 원인 | 왜 현재 코드가 요구사항을 만족하지 않는가 |
| GREEN | 최소로 무엇을 구현했는가 |
| 리팩터링 | 중복·이름·경계를 어떻게 정리했는가 |
| 보안 | 어떤 공격·오용을 차단했는가 |
| 검증 | 집중·전체 테스트 명령과 결과 |
| 잔여 위험 | 로컬에서 증명할 수 없는 것은 무엇인가 |

RED는 “코드가 나쁘다”는 뜻이 아니라 아직 요구 동작이 존재하지 않음을 재현하는 정상 단계다. GREEN은 테스트를 통과하는 최소 구현 상태이며, 전체 품질 완료를 의미하지 않는다. 리팩터링과 전체 검증, 보안 리뷰가 이어져야 task가 완료된다.

## 10. 기본 검증 명령

```powershell
pnpm --filter @account-book/contracts test
pnpm --filter @account-book/database test
pnpm --filter @account-book/api test
pnpm --filter @account-book/web test
pnpm --filter @account-book/e2e test
pnpm test:db
pnpm lint
pnpm typecheck
pnpm build
pnpm verify
```

실제 명령은 각 계획에서 더 좁은 test file부터 시작한다. 마지막에는 전체 `pnpm verify`, 실제 disposable PostgreSQL, E2E, production dependency audit를 실행한다.

## 11. 문서 갱신 규칙

각 task가 끝날 때 다음을 확인한다.

1. public contract가 바뀌면 API 문서와 예제를 갱신한다.
2. migration이 생기면 schema·role·rollback·운영 문서를 갱신한다.
3. 보안 경계가 바뀌면 threat model과 verification checklist를 갱신한다.
4. 테스트 개수보다 테스트 대상과 RED/GREEN 증거를 기록한다.
5. 실제 플랫폼 증거와 로컬 대체 검증을 구분한다.
6. 코드 주석은 행동 원리·매개변수·불변식 중심으로 작성한다.
7. secret, 실제 사용자 정보, 실제 금융 내역은 문서에 넣지 않는다.

## 12. 이후 학습 순서

1. 금융 mutation request binding
2. 계약과 공개 오류
3. PostgreSQL migration·RLS
4. API controller·service·repository
5. PC 웹 BFF·React Query·화면
6. 모바일 인증·React Query·화면
7. 교차 클라이언트 일관성
8. CSV·릴리스·운영 보안

각 단계의 계획 문서는 이 가이드의 개념을 실제 파일, 타입, 테스트와 연결한다.
