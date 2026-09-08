# 초급 개발자를 위한 코드·함수 읽기

이 가이드는 2026-09-08의 실제 구현을 기준으로 합니다. [전체 문서 지도](../README.md)에서 분야별 상세 문서로 이동할 수 있습니다. 예제의 UUID·금액은 가짜 데이터입니다.

## 1. 파일을 열었을 때 먼저 볼 것

- `import`: 이 파일이 다른 코드에서 가져오는 도구입니다.
- `type`/`interface`: 값의 모양을 TypeScript에 설명합니다. 실행 중 잘못된 JSON을 스스로 막지는 못합니다.
- Zod `Schema`: 실행 중에도 입력을 검사하는 규칙입니다. `.strict()`는 정하지 않은 필드를 거부합니다.
- `export`: 다른 파일에서도 사용할 수 있게 공개합니다.
- 함수: 입력을 받아 계산·검증·외부 호출을 하고 결과를 돌려주는 단위입니다.
- `async`/`Promise`: DB·네트워크 결과를 기다리는 함수입니다. `await`가 있다고 요청이 성공하거나 안전하다는 뜻은 아닙니다.

함수 위의 `/** ... */`는 JSDoc 주석입니다. 에디터에서 함수 이름에 마우스를 올리면 설명을 볼 수 있습니다. 주석 자체는 실행되지 않습니다.

```ts
/**
 * 입력된 정수를 표시할 원화 문자열로 만든다. 학습용이며 제품 함수는 아니다.
 * @param amountKrw 표시할 원화 정수. 서버 입력 검증을 대신하지 않는다.
 * @returns 화면에 표시할 문자열. DB 저장이나 네트워크 호출은 하지 않는다.
 */
function displayWon(amountKrw: number): string {
  return `${amountKrw.toLocaleString("ko-KR")}원`;
}
```

`amountKrw`는 **매개변수 이름**, 호출할 때 넘긴 `1200`은 **인수**입니다. `@returns`는 결과, `@throws`는 던질 수 있는 오류를 설명합니다. 생성자는 객체 초기화, 콜백은 다른 코드가 나중에 호출하는 함수입니다. 이번 주석은 역할뿐 아니라 입력 출처, 실행 순서, 반환·오류·부작용을 함께 설명합니다.

## 2. 저장소는 왜 나뉘나요?

| 경로 | 쉬운 설명 | 현재 구현 |
| --- | --- | --- |
| `apps/web/src/app` | URL에 맞는 화면과 웹 서버 입구 | 인증 화면·route |
| `apps/web/src/queries/auth.ts`와 `src/components/auth` | 로그인 관련 UI 상태·행동 | 인증 hook·컴포넌트 |
| `apps/web/src/lib/http` | 브라우저 HTTP 요청 도구 | ky와 CSRF 처리 |
| `apps/web/src/server` | 브라우저에 보내면 안 되는 서버 코드 | 인증·쿠키·암호화·저장소·위임 요청 |
| `apps/api/src` | 별도 Node 서버 | health·me·JWT guard |
| `packages/contracts/src` | 웹·API가 함께 보는 입력/응답 규칙 | 인증 및 금융 계약 |
| `packages/database/src` | DB 연결과 스키마 표현 | 인증·replay 기반 |
| `supabase/migrations` | DB 구조를 순서대로 만드는 SQL | 인증·replay 4개 migration |
| `scripts` | 개발·push·CI 안전 검사 | 구조·브랜치·비밀 패턴 검사 |

같은 저장소 안에 있어도 모든 파일이 브라우저에서 실행되는 것은 아닙니다. 특히 `server`의 키·DB URL·공급자 토큰은 클라이언트 번들로 보내면 안 됩니다. 모바일 디렉터리는 아직 없습니다.

## 3. 실제 이메일 로그인 흐름

1. 로그인 화면이 이메일·비밀번호를 받습니다. 제출 시 FormData로 DOM 입력을 읽고, React state는 오류·진행 같은 화면 상태를 관리합니다.
2. 인증 hook이 mutation을 시작해 로딩/오류 상태를 관리합니다. ky가 같은 출처의 BFF로 요청합니다. 쿠키 인증 변경 요청에는 CSRF 방어가 적용됩니다.
3. Next route는 `route-adapter.ts`와 `auth-controller.ts`로 연결됩니다. HTTP 입력 검증과 공개 오류 변환을 한곳에서 처리합니다.
4. `email-auth-service.ts`는 실제 인증 공급자를 추상화한 `auth-provider-port.ts`를 사용합니다. 운영 adapter는 `supabase-auth-adapter.ts`, 폐기용 테스트 대역은 `fake-auth-provider.ts`입니다.
5. 성공하면 `session-service.ts`가 서버 세션을 만들고 `postgres-auth-repository.ts`가 저장합니다. DB에는 세션 selector 원문 대신 해시, 공급자 credential은 암호화된 형태를 보관합니다.
6. 응답은 `HttpOnly` 세션 쿠키를 설정합니다. 브라우저 JavaScript에 공급자 access/refresh token을 넘기지 않습니다.
7. 화면은 다음 URL로 이동합니다. **현재 목적지 `/app`의 실제 장부 화면은 아직 없으므로 로그인 코드 구현과 제품 완성은 별개입니다.**

HttpOnly는 `document.cookie` 같은 JavaScript 쿠키 API로 값을 읽지 못하게 하는 속성입니다. 그러나 XSS가 사용자의 인증된 요청을 보내는 위험까지 막지는 못합니다. 로그인 mutation 입력은 프로세스 메모리에 남을 수 있습니다. “영구 저장하지 않음”을 “어떤 메모리에도 남지 않음”으로 해석하지 마세요.

## 4. 로그인 후 API가 사용자를 확인하는 과정

`/api/me` 요청에서 BFF는 세션을 검증한 뒤 `delegated-jwt-signer.ts`로 30초 ES256 JWT를 만듭니다. 이 JWT는 Supabase 사용자 토큰을 그대로 전달한 것이 아니라 **BFF가 해당 요청을 대신 수행하도록 발급하는 토큰**입니다.

`delegated-api-client.ts`가 Node API를 호출합니다. `apps/api/src/auth/auth.guard.ts`는 서명·키 ID·issuer/audience·기간·scope·요청 내용·request ID를 확인합니다. DB의 replay 저장소는 `jti`를 한 번만 소비하도록 합니다. 검증 실패나 DB 실패는 허용으로 바뀌지 않습니다.

| 입력 | 의미 | 주의점 |
| --- | --- | --- |
| `userId`, `sessionId` | 검증된 사용자·세션 | 브라우저 body의 임의 값을 믿지 않음 |
| `method`, `target`, `body` | 실제 보낼 요청 | 서명한 내용과 전송 byte가 일치해야 함 |
| `scope` | 이번 요청의 최소 권한 | UI에서 버튼을 숨기는 것과 다름 |
| `requestId` | 요청 추적용 식별자 | 서버에서 생성, 민감 데이터 포함 금지 |
| `jti` | 일회용 JWT 식별자 | 업무 거래 ID·멱등성 키와 다름 |

같은 JWT의 재사용을 막는 것과, 사용자가 저장 버튼을 재시도해 거래가 중복 저장되지 않게 하는 것은 서로 다른 문제입니다.

## 5. 현재 금융 코드는 무엇을 하나요?

`packages/contracts/src/transactions.ts`는 거래를 저장하지 않습니다. `CreateTransactionInputSchema`는 거래 요청의 **모양**을 검사합니다. 아래는 실제 schema 사용 방식이고 DB/API 호출은 없습니다.

```ts
import { CreateTransactionInputSchema } from "@account-book/contracts";

const result = CreateTransactionInputSchema.safeParse({
  accountId: "11111111-1111-4111-8111-111111111111",
  categoryId: "22222222-2222-4222-8222-222222222222",
  amountKrw: 1200,
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  occurredOn: "2026-09-08",
  type: "expense",
  memo: "학습용 지출",
});

if (result.success) {
  // 후속 저장 계층에는 입력 원본이 아니라 정규화된 result.data를 전달해야 한다.
  const validatedInput = result.data;
  // 이 예제는 검증까지만 한다. 현재 운영 거래 저장 API는 없다.
}
```

- `amountKrw`: 1 이상 안전한 정수 범위의 원화 금액입니다. 소수나 문자열로 보내지 않습니다.
- `occurredOn`: 거래가 발생한 달력 날짜입니다. UTC 이벤트 시각인 `createdAt`과 다릅니다.
- `accountId`/`categoryId`: 대상 계좌·분류 UUID입니다. 유효한 UUID여도 본인 소유인지는 별도 서버/DB 검사가 필요합니다.
- `idempotencyKey`: **같은 생성 시도**를 식별하는 UUID v4입니다. 새 시도에는 새 키, 같은 시도 재전송에는 같은 키를 쓸 정책입니다. 현재 계약만 있고 DB 중복 방지는 후속 구현입니다.
- 거래 `id`: 저장 성공 시 서버가 부여할 영구 리소스 ID입니다. 멱등성 키와 다릅니다.
- `expectedVersion`: 수정할 때 내가 마지막으로 본 버전입니다. 서버가 현재 버전과 비교해 다른 기기의 변경을 덮어쓰지 않게 할 예정입니다.

공통 `LedgerIdSchema`는 리소스 UUID를 소문자로 정규화합니다. 그래서 같은 계좌를 대문자·소문자로 달리 적어 “다른 계좌 이체” 검증을 우회하지 못합니다. 이 정규화는 인증 토큰이나 멱등성 키 정책을 바꾸지 않습니다.

## 6. DB 구조 용어와 현재 상태

- 테이블/행: 같은 종류의 데이터를 모아 둔 표와 한 건의 기록입니다.
- 기본 키(PK): 행 하나를 구별합니다. 외래 키(FK)는 다른 행과의 관계를 보장합니다.
- 인덱스: 조회를 빠르게 하는 보조 구조입니다. 저장·수정 비용도 증가합니다.
- 트랜잭션: 여러 저장을 전부 성공 또는 전부 취소합니다. 이체 출금만 성공하면 안 되므로 필요합니다.
- migration: DB 구조 변경의 순서가 있는 파일입니다. TypeScript 타입만 작성해도 DB 테이블이 생기는 것은 아닙니다.
- role/GRANT: 어떤 DB 접속 사용자가 어떤 테이블 작업을 할 수 있는지 정합니다.
- RLS: 허용된 테이블 안에서도 사용자별 행 접근을 제한합니다. 인증 저장소의 역할 권한과 금융 원장의 사용자별 RLS는 다른 경계입니다.
- pool: 요청마다 새 연결을 무한히 만들지 않고 정해진 수의 DB 연결을 재사용합니다.

현재는 인증 6개 테이블과 별도 JWT replay 테이블만 있습니다. `auth_rate_limits`라는 테이블이 있어도 실제 지속형 rate limit 서비스가 연결됐다는 뜻은 아닙니다. 금융 원장·사용자별 RLS·원자적 이체·업무 멱등성 저장은 미구현입니다. 자세한 열과 역할은 [인증 스키마](../database/auth-schema.ko.md)를 참고하세요.

## 7. 다음 금융 기능은 어떤 순서로 구현하나요?

공용 계약 → SQL 제약/RLS → repository → service → API/BFF → 웹 화면 → 별도 모바일 화면 → 교차 클라이언트 검증 순서입니다. 현재 공용 계약 다음 단계입니다.

repository는 SQL, service는 업무 규칙, controller는 HTTP 입력/응답을 담당합니다. TanStack Query는 서버 데이터를 조회·재조회하고 React local state는 폼·탭 같은 화면 상태를 맡습니다. 서버 데이터를 별도 전역 저장소에 중복 보관하지 않습니다.

함수 주석을 수정할 때는 구현에 없는 보장을 쓰지 않습니다. 주석·문서 변경만 했다면 실행 코드 동일성·타입·lint를 확인하고, 행동이 바뀌면 RED→GREEN 회귀 테스트를 함께 남깁니다. 전체 테스트 성공·운영 검증·침투 테스트 완료는 실제 실행 증거가 있을 때만 기록합니다.
