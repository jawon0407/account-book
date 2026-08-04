# 금융 변경 요청 보안 경계 구현 계획

> **For agentic workers:** 이 계획은 `superpowers:subagent-driven-development`로 실행한다. 각 Task는 구현 담당자와 요구사항 검토자, 코드 품질 검토자가 순서대로 확인하며, 다음 Task로 넘어가기 전에 테스트와 문서를 함께 완료한다.

**목표:** PC 웹의 BFF가 금융 데이터 변경 요청의 정확한 HTTP method·target·content type·body·request ID·scope에 결속된 단명 JWT를 발급하고, NestJS API가 동일한 원문 바이트를 검증한 뒤에만 요청을 허용하도록 만든다.

**아키텍처:** 브라우저 요청은 Next.js Route Handler에서 공개 계약으로 검증한다. BFF는 검증된 객체를 한 번만 JSON 바이트로 직렬화하고, 그 바이트를 delegated JWT에 결속한 뒤 동일한 바이트를 Heroku API로 전송한다. API는 Fastify JSON parser에서 원문 바이트를 보존하고 `AuthGuard`에서 framing과 JWT 결속을 검증한다. 이 계획은 금융 테이블이나 공개 금융 route를 만들지 않으며, 다음 원장 기능 계획이 안전하게 사용할 기반만 연다.

**기술 스택:** TypeScript 6, Node.js 22, Next.js 16 Node.js Route Handler, NestJS 11, Fastify 5, Zod, `jose`, Vitest, pnpm.

**선행 조건:** TASK 14 인증 E2E 경계가 완료되어야 PR #2를 병합할 수 있다. 이 계획의 작업은 같은 feature branch에서 진행할 수 있지만, TASK 14의 hosted 증거를 대체하지 않는다.

**보안 불변식:**

- 브라우저가 보낸 `Authorization`, `Cookie`, `Host`, `X-Request-Id`를 Heroku API로 전달하지 않는다.
- `userId`, `sessionId`, delegated scope는 브라우저 body나 query에서 읽지 않는다.
- 서명한 body와 전송한 body는 같은 `Uint8Array` 인스턴스에서 나온 바이트여야 한다.
- 보호된 JSON body는 32 KiB를 초과할 수 없다.
- 중복 header, 모호한 framing, 지원하지 않는 content type, 빈 변경 body는 검증 전에 거부한다.
- API 오류는 JWT, cookie, 원문 금융 body, SQL, 내부 URL을 공개하거나 로그에 남기지 않는다.
- 이 단계에서는 `PUT`을 열지 않는다. 원장 수정은 다음 계획에서 `PATCH` + `expectedVersion`으로 설계한다.
- 새 scope를 추가해도 route metadata가 없거나 잘못되면 기본 scope를 추론하지 않고 거부한다.

## 역할별 실행 순서

| 순서 | 역할 | 산출물 |
|---|---|---|
| 1 | 기획자 | acceptance criteria와 사용자 학습 포인트 점검 |
| 2 | 프로젝트 리더 | Task 의존성, 파일 소유권, 커밋 경계 확정 |
| 3 | 백엔드 개발자 | contracts, raw-body parser, API guard TDD 구현 |
| 4 | 프론트 개발자 | BFF delegated client TDD 구현 |
| 5 | 보안 개발자 | negative matrix, secret·로그·framing 검토 |
| 6 | 프로젝트 리더 | 전체 검증과 문서 증거 확인 |

구현 담당자는 공유 파일 충돌을 피하기 위해 동시에 편집하지 않는다. 독립적인 검토와 읽기 전용 분석만 병렬로 수행한다.

## 파일 지도

### 새 파일

- `apps/api/src/auth/raw-json-body.ts`: JSON 원문 바이트 보존과 크기 제한 등록 함수.
- `apps/api/src/auth/raw-json-body.test.ts`: UTF-8, JSON, 크기 제한, parser 동작 테스트.
- `apps/api/src/types/fastify.d.ts`: 검증 전용 `rawBody` request 확장.
- `apps/api/src/auth/mutation-boundary.integration.test.ts`: 실제 Nest/Fastify 주입 기반 negative matrix.
- `apps/web/src/server/http/delegated-api-client.ts`: 서명과 전송에 같은 바이트를 사용하는 내부 API client.
- `apps/web/src/server/http/delegated-api-client.test.ts`: header allowlist, exact-body, timeout 테스트.

### 수정 파일

- `packages/contracts/src/internal-api.ts`: body 상한과 M2 delegated scope.
- `packages/contracts/src/internal-api.test.ts`: scope와 상한 계약 테스트.
- `apps/api/src/main.ts`: raw JSON parser 등록.
- `apps/api/src/auth/auth.guard.ts`: GET 및 body-bearing method별 framing 검증.
- `apps/api/src/auth/auth.guard.test.ts`: 변경 요청 RED/GREEN 단위 테스트.
- `apps/web/src/server/http/auth-controller.ts`: `/v1/me` 호출을 공통 delegated client로 이동.
- `apps/web/src/server/http/auth-controller.test.ts`: client 위임과 공개 응답 경계 테스트.
- `apps/web/src/server/container.ts`: 검증된 내부 URL과 signer로 client 구성.
- `apps/web/src/server/container.test.ts`: 잘못된 내부 URL과 의존성 wiring 테스트.
- `docs/guides/full-stack-development-flow.ko.md`: 실제 RED/GREEN 결과와 요청 추적 예시.
- `docs/guides/security-auth-testing.md`: body 결속 negative matrix와 명령.
- `docs/architecture/backend-authentication.ko.md`: BFF→API 변경 요청 신뢰 경계.
- `docs/security/verification-checklist.md`: 변경 요청 검증 항목과 잔여 위험.

## Task 1: 내부 API 계약에 body 상한과 최소 권한 scope 추가

**파일**

- Modify: `packages/contracts/src/internal-api.ts`
- Test: `packages/contracts/src/internal-api.test.ts`

### 1.1 RED 테스트 작성

다음 기대를 추가한다.

```ts
import {
  DELEGATED_JSON_BODY_MAX_BYTES,
  DelegatedScopeSchema,
} from "./internal-api.js";

it("exposes the fixed JSON body ceiling", () => {
  expect(DELEGATED_JSON_BODY_MAX_BYTES).toBe(32_768);
});

it.each([
  "me:read",
  "account:read",
  "account:write",
  "category:read",
  "category:write",
  "transaction:read",
  "transaction:write",
  "dashboard:read",
])("accepts the allowlisted scope %s", (scope) => {
  expect(DelegatedScopeSchema.parse(scope)).toBe(scope);
});

it.each(["admin", "transaction:*", "user:write", ""])(
  "rejects the non-allowlisted scope %s",
  (scope) => {
    expect(DelegatedScopeSchema.safeParse(scope).success).toBe(false);
  },
);
```

### 1.2 RED 확인

Run:

```powershell
pnpm --filter @account-book/contracts test -- internal-api.test.ts
```

Expected: `DELEGATED_JSON_BODY_MAX_BYTES` export와 새 scope가 없어 실패한다.

### 1.3 최소 GREEN 구현

```ts
export const DELEGATED_JSON_BODY_MAX_BYTES = 32_768;

export const DelegatedScopeSchema = z.enum([
  "me:read",
  "account:read",
  "account:write",
  "category:read",
  "category:write",
  "transaction:read",
  "transaction:write",
  "dashboard:read",
]);
```

매개변수 원리:

- `DELEGATED_JSON_BODY_MAX_BYTES`: Fastify parser와 guard가 공유하는 단일 상한이다. 서로 다른 숫자를 쓰면 parser와 검증 경계가 달라진다.
- `scope`: 사용자의 일반 역할이 아니라 BFF가 이번 한 요청에서 수행할 수 있는 행위다.

### 1.4 GREEN 확인

Run:

```powershell
pnpm --filter @account-book/contracts test -- internal-api.test.ts
pnpm --filter @account-book/contracts typecheck
```

Expected: 두 명령 모두 exit code 0.

### 1.5 커밋

```powershell
git add packages/contracts/src/internal-api.ts packages/contracts/src/internal-api.test.ts
git commit -m "feat: define delegated finance capabilities"
```

## Task 2: Fastify JSON parser에서 원문 body 보존

**파일**

- Create: `apps/api/src/auth/raw-json-body.ts`
- Create: `apps/api/src/auth/raw-json-body.test.ts`
- Create: `apps/api/src/types/fastify.d.ts`
- Modify: `apps/api/src/main.ts`

### 2.1 RED 테스트 작성

테스트용 Fastify 인스턴스에 parser를 등록하고 다음을 검증한다.

```ts
it("preserves the exact accepted JSON bytes", async () => {
  const body = Buffer.from('{"memo":"한글","amountKrw":"12000"}', "utf8");
  const response = await server.inject({
    method: "POST",
    url: "/capture",
    headers: { "content-type": "application/json" },
    payload: body,
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    parsed: { memo: "한글", amountKrw: "12000" },
    raw: body.toString("base64url"),
  });
});

it("rejects a body over the contract ceiling", async () => {
  const response = await server.inject({
    method: "POST",
    url: "/capture",
    headers: { "content-type": "application/json" },
    payload: Buffer.alloc(DELEGATED_JSON_BODY_MAX_BYTES + 1, 0x20),
  });

  expect(response.statusCode).toBe(413);
});

it("rejects malformed JSON without echoing the body", async () => {
  const response = await server.inject({
    method: "POST",
    url: "/capture",
    headers: { "content-type": "application/json" },
    payload: Buffer.from('{"memo":', "utf8"),
  });

  expect(response.statusCode).toBe(400);
  expect(response.body).not.toContain("memo");
});
```

### 2.2 RED 확인

Run:

```powershell
pnpm --filter @account-book/api test -- raw-json-body.test.ts
```

Expected: 등록 함수와 request type이 없어 컴파일 실패한다.

### 2.3 최소 GREEN 구현

`apps/api/src/types/fastify.d.ts`:

```ts
import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Uint8Array;
  }
}
```

`apps/api/src/auth/raw-json-body.ts`의 핵심:

```ts
import type { FastifyInstance } from "fastify";
import { DELEGATED_JSON_BODY_MAX_BYTES } from "@account-book/contracts/internal-api";

/**
 * JSON을 객체로 변환하기 전에 원문 바이트를 보존한다.
 * @param server Nest가 사용하는 Fastify 인스턴스.
 */
export function registerRawJsonBody(server: FastifyInstance): void {
  server.removeContentTypeParser("application/json");
  server.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: DELEGATED_JSON_BODY_MAX_BYTES },
    (request, body, done) => {
      const bytes = new Uint8Array(body);
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        request.rawBody = bytes;
        done(null, JSON.parse(text) as unknown);
      } catch {
        done(new Error("DELEGATED_REQUEST_INVALID"), undefined);
      }
    },
  );
}
```

`apps/api/src/main.ts`에서는 Nest app을 생성한 직후, route 초기화 전에 Fastify adapter의 instance에 한 번 등록한다.

행동 원리:

- `parseAs: "buffer"`는 JSON parser가 문자열이나 객체로 바꾸기 전 수신 바이트를 확보한다.
- `fatal: true`는 잘못된 UTF-8을 대체 문자로 조용히 바꾸지 않는다.
- `bodyLimit`는 큰 body를 메모리에 올리기 전에 transport 경계에서 차단한다.
- `rawBody`는 검증에만 사용하고 controller나 로그에 전달하지 않는다.

### 2.4 GREEN 확인

Run:

```powershell
pnpm --filter @account-book/api test -- raw-json-body.test.ts
pnpm --filter @account-book/api typecheck
```

Expected: 정확한 바이트·잘못된 UTF-8·잘못된 JSON·크기 제한 테스트가 모두 통과한다.

### 2.5 커밋

```powershell
git add apps/api/src/auth/raw-json-body.ts apps/api/src/auth/raw-json-body.test.ts apps/api/src/types/fastify.d.ts apps/api/src/main.ts
git commit -m "feat: preserve delegated json request bytes"
```

## Task 3: AuthGuard가 변경 요청 framing과 exact body를 검증

**파일**

- Modify: `apps/api/src/auth/auth.guard.ts`
- Modify: `apps/api/src/auth/auth.guard.test.ts`

### 3.1 RED 테스트 작성

테스트 표를 추가한다.

| 사례 | 기대 |
|---|---|
| `POST`, JSON, exact raw body, `transaction:write` | verifier에 정확한 descriptor 전달 |
| `PATCH`, JSON, exact raw body | 허용 |
| `DELETE`, JSON, exact raw body | 허용 |
| `PUT` | verifier 호출 전 거부 |
| 빈 mutation body | 거부 |
| `text/plain` | 거부 |
| `application/json; charset=utf-8` | canonical `application/json`으로 검증 |
| 중복 `content-type` 또는 `x-request-id` | 거부 |
| `transfer-encoding` 존재 | 거부 |
| `content-length`와 raw body 길이 불일치 | 거부 |
| body 상한 초과 | 거부 |
| route scope metadata 누락 | 거부 |

핵심 assertion:

```ts
expect(verifier.verify).toHaveBeenCalledWith({
  token,
  request: {
    method: "POST",
    target: "/v1/test-mutation?b=2&a=1",
    contentType: "application/json",
    body: exactBody,
    requestId,
  },
  requiredScope: "transaction:write",
});
```

### 3.2 RED 확인

Run:

```powershell
pnpm --filter @account-book/api test -- auth.guard.test.ts
```

Expected: 현재 guard가 GET 이외 method를 모두 거부하므로 정상 변경 요청 테스트가 실패한다.

### 3.3 최소 GREEN 구현

`requestIdAndFraming`을 descriptor 생성 함수로 바꾼다.

```ts
type GuardRequest = Readonly<{
  method: "GET" | "POST" | "PATCH" | "DELETE";
  target: string;
  contentType: string | null;
  body: Uint8Array;
  requestId: string;
}>;
```

판단 순서:

1. raw header 배열 길이와 중복 여부를 검사한다.
2. canonical UUID인 `x-request-id`를 읽는다.
3. `transfer-encoding`이 있으면 거부한다.
4. GET은 content type이 없고 body가 0 byte인 경우만 허용한다.
5. POST/PATCH/DELETE는 canonical JSON content type과 1..32768 byte raw body만 허용한다.
6. `content-length`가 있으면 canonical decimal인지, raw body 길이와 같은지 검사한다.
7. `request.raw.url`을 target으로 사용한다.
8. 완성된 descriptor와 route scope를 verifier에 전달한다.

주요 매개변수:

- `request.raw.url`: proxy가 재작성한 외부 URL이 아니라 Nest/Fastify가 실제 처리하는 path와 query다.
- `contentLength`: 신뢰하지 않는다. raw body 실제 길이와 비교하는 보조 증거로만 사용한다.
- `rawBody`: parser가 보존한 검증 대상이다. controller가 다시 `JSON.stringify`한 값으로 대체하지 않는다.
- `requiredScope`: decorator metadata에서만 읽으며 JWT scope와 일치해야 한다.

### 3.4 GREEN 확인

Run:

```powershell
pnpm --filter @account-book/api test -- auth.guard.test.ts
pnpm --filter @account-book/api test -- jwt-verifier.test.ts
pnpm --filter @account-book/api typecheck
```

Expected: 기존 GET 경계를 유지하면서 변경 요청 표 전체가 통과한다.

### 3.5 커밋

```powershell
git add apps/api/src/auth/auth.guard.ts apps/api/src/auth/auth.guard.test.ts
git commit -m "feat: verify delegated mutation framing"
```

## Task 4: BFF 내부 API client가 같은 바이트를 서명하고 전송

**파일**

- Create: `apps/web/src/server/http/delegated-api-client.ts`
- Create: `apps/web/src/server/http/delegated-api-client.test.ts`
- Modify: `apps/web/src/server/http/auth-controller.ts`
- Modify: `apps/web/src/server/http/auth-controller.test.ts`
- Modify: `apps/web/src/server/container.ts`
- Modify: `apps/web/src/server/container.test.ts`

### 4.1 RED 테스트 작성

```ts
it("signs and sends the same exact bytes with only server-owned headers", async () => {
  const body = new TextEncoder().encode('{"amountKrw":"12000"}');
  const response = await client.request({
    body,
    contentType: "application/json",
    method: "POST",
    scope: "transaction:write",
    sessionId: "session-id",
    target: "/v1/test-mutation",
    userId: "user-id",
  });

  expect(signer.sign).toHaveBeenCalledWith(expect.objectContaining({ body }));
  expect(fetcher).toHaveBeenCalledWith(
    new URL("https://api.example.test/v1/test-mutation"),
    expect.objectContaining({
      method: "POST",
      body,
      headers: {
        accept: "application/json",
        authorization: "Bearer delegated-token",
        "content-type": "application/json",
        "x-request-id": requestId,
      },
    }),
  );
  expect(response.status).toBe(200);
});
```

추가 RED:

- GET에 non-empty body를 주면 fetch 전에 거부.
- mutation에 `null` content type 또는 empty body를 주면 거부.
- absolute target, fragment, credentials, 지원하지 않는 method를 거부.
- signer 실패, timeout, network 오류는 원문 오류를 노출하지 않고 고정 내부 오류로 변환.
- browser cookie·authorization·host를 입력할 매개변수가 public interface에 존재하지 않음.

### 4.2 RED 확인

Run:

```powershell
pnpm --filter @account-book/web test -- delegated-api-client.test.ts
```

Expected: client가 없어 컴파일 실패한다.

### 4.3 최소 GREEN 구현

```ts
export type DelegatedApiRequest = Readonly<{
  body: Uint8Array;
  contentType: null | "application/json";
  method: "GET" | "POST" | "PATCH" | "DELETE";
  scope: DelegatedScope;
  sessionId: string;
  target: `/${string}`;
  userId: string;
}>;

export class DelegatedApiClient {
  public constructor(
    private readonly baseUrl: URL,
    private readonly signer: DelegatedJwtSignerPort,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async request(input: DelegatedApiRequest): Promise<Response> {
    // validate method/body/contentType/target before signing
    const signed = await this.signer.sign(input);
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${signed.token}`,
      "x-request-id": signed.requestId,
    });
    if (input.contentType !== null) headers.set("content-type", input.contentType);
    return this.fetcher(new URL(input.target, this.baseUrl), {
      method: input.method,
      headers,
      body: input.method === "GET" ? undefined : input.body,
      signal: AbortSignal.timeout(3_000),
    });
  }
}
```

실제 구현에서는 constructor에서 HTTPS 또는 명시된 loopback 정책, root-only base URL, credential·fragment 부재를 확인하고 clone한다.

행동 원리:

- route controller가 객체를 JSON 문자열로 만들고 즉시 `TextEncoder`로 한 번만 바이트화한다.
- client는 그 바이트를 signer와 fetch에 그대로 전달하고 재직렬화하지 않는다.
- 내부 client는 응답을 domain contract로 해석하지 않는다. 각 BFF controller가 자신의 공개 response schema를 검증한다.
- `/api/me`도 이 client를 사용하게 바꾸어 읽기와 쓰기의 header/timeout 규칙이 갈라지지 않게 한다.

### 4.4 `/api/me` 회귀 테스트

Run:

```powershell
pnpm --filter @account-book/web test -- auth-controller.test.ts
pnpm --filter @account-book/web test -- container.test.ts
```

Expected:

- session 만료 판단과 공개 오류 모양은 기존과 동일하다.
- `me()`가 내부 client에 `GET`, empty body, `me:read`, 고정 `/v1/me`만 전달한다.
- provider access token이나 browser cookie는 signer/client로 전달되지 않는다.

### 4.5 GREEN 확인

Run:

```powershell
pnpm --filter @account-book/web test -- delegated-api-client.test.ts auth-controller.test.ts container.test.ts
pnpm --filter @account-book/web typecheck
```

Expected: 신규 client와 `/api/me` 회귀 테스트가 모두 통과한다.

### 4.6 커밋

```powershell
git add apps/web/src/server/http/delegated-api-client.ts apps/web/src/server/http/delegated-api-client.test.ts apps/web/src/server/http/auth-controller.ts apps/web/src/server/http/auth-controller.test.ts apps/web/src/server/container.ts apps/web/src/server/container.test.ts
git commit -m "refactor: centralize delegated api requests"
```

## Task 5: 실제 Nest/Fastify 경계 negative matrix

**파일**

- Create: `apps/api/src/auth/mutation-boundary.integration.test.ts`

### 5.1 RED 통합 테스트 작성

테스트 파일 안에만 다음 route를 선언한다.

```ts
@Controller()
@UseGuards(AuthGuard)
class TestMutationController {
  @Post("/v1/test-mutation")
  @RequireDelegatedScope("transaction:write")
  public create(@Req() request: FastifyRequest): unknown {
    return { userId: request.principal.userId, body: request.body };
  }
}
```

실제 `DelegatedJwtSigner`와 실제 verifier를 사용하되, replay store는 테스트 double 또는 disposable DB의 명시된 구현을 사용한다.

필수 matrix:

1. exact POST body + exact token → 200.
2. 서명 후 body 한 byte 변경 → 401.
3. target query 변경 → 401.
4. `transaction:read` token으로 write route → 401/403 중 프로젝트 고정 정책.
5. 같은 JWT와 request ID 재사용 → 두 번째 요청 거부.
6. 만료된 JWT → 거부.
7. 잘못된 issuer/audience/key ID → 거부.
8. duplicate authorization/content-type/request ID → 거부.
9. oversized body → 413이며 verifier 미호출.
10. response/log에 JWT, 원문 body, 내부 verifier detail 없음.

### 5.2 RED 확인

Run:

```powershell
pnpm --filter @account-book/api test -- mutation-boundary.integration.test.ts
```

Expected: Task 2와 3 이전에는 정상 POST가 실패한다. Task 2~4가 끝난 뒤에는 아직 작성하지 않은 matrix assertion 때문에 RED여야 한다.

### 5.3 최소 fixture와 GREEN

- production route는 추가하지 않는다.
- test controller와 deterministic keypair는 테스트 파일 또는 기존 test fixture에서만 구성한다.
- `Date.now()`에 의존하지 않고 고정 clock을 주입한다.
- 토큰이나 body를 snapshot에 기록하지 않는다.
- 실패 응답은 기존 공개 `ApiError` contract만 검사한다.

Run:

```powershell
pnpm --filter @account-book/api test -- mutation-boundary.integration.test.ts
pnpm --filter @account-book/api test
```

Expected: matrix와 API 전체 테스트가 exit code 0.

### 5.4 커밋

```powershell
git add apps/api/src/auth/mutation-boundary.integration.test.ts
git commit -m "test: prove delegated mutation boundary"
```

## Task 6: 학습·보안 문서에 실제 증거 기록

**파일**

- Modify: `docs/guides/full-stack-development-flow.ko.md`
- Modify: `docs/guides/security-auth-testing.md`
- Modify: `docs/architecture/backend-authentication.ko.md`
- Modify: `docs/security/verification-checklist.md`

### 6.1 문서에 기록할 내용

`docs/guides/full-stack-development-flow.ko.md`에는 실제 구현 후 다음 표를 추가한다.

| 항목 | 기록 예시 |
|---|---|
| 사용자 행동 | PC에서 지출 저장 버튼을 누름 |
| BFF 입력 | strict public contract로 검증된 거래 객체 |
| 신뢰하지 않는 값 | browser userId, authorization, cookie 전달값, request ID |
| canonical bytes | 실제 사용한 직렬화 규칙과 byte length |
| RED | 기존 GET-only guard가 POST를 거부한 테스트 이름과 결과 |
| GREEN | exact body는 통과하고 1-byte 변경은 거부한 테스트 이름과 결과 |
| 매개변수 | method, target, contentType, body, requestId, scope의 출처 |
| 잔여 위험 | BFF 침해 시 허용된 scope로 단기 요청 가능; key rotation/runbook으로 완화 |

보안 문서에는 다음 운영 규칙을 추가한다.

- `BFF_JWT_PRIVATE_KEY`는 Vercel server-only secret, public key set은 Heroku secret.
- 현재 key와 직전 public key만 검증하며 rotation overlap을 제한한다.
- request ID와 `jti`는 원문 body 없이 구조화 로그에 기록한다.
- replay store 장애 시 fail closed.
- rate limit은 인증 principal + route + 신뢰 가능한 platform IP 보조 신호로 구성하며 IP 단독 식별을 금지한다.
- 32 KiB 변경 body 상한과 3초 BFF→API timeout.

### 6.2 문서 검증

Run:

```powershell
rg -n "미작성|임시 문구|결정 대기|추후 확정" docs/guides/full-stack-development-flow.ko.md docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/security/verification-checklist.md
```

Expected: 미결 임시 문구 없음. 의도적으로 남긴 장기 과제는 담당자·재검토 조건·기한이 있어야 한다.

### 6.3 커밋

```powershell
git add docs/guides/full-stack-development-flow.ko.md docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/security/verification-checklist.md
git commit -m "docs: explain delegated mutation development flow"
```

## Task 7: 전체 품질 게이트와 다음 계획 인계

### 7.1 정적·단위·빌드 검증

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

Expected: 모두 exit code 0. 같은 실패를 여러 명령에서 중복 수정하지 않고 최초 root cause를 해결한다.

### 7.2 실제 DB와 E2E 검증

Run:

```powershell
pnpm test:db
pnpm --filter @account-book/e2e test
```

Expected:

- disposable PostgreSQL에서 replay 소비가 원자적이다.
- 인증 브라우저 E2E 회귀가 없다.
- hosted E2E는 TASK 14의 동일 SHA 증거가 없으면 “완료”로 표시하지 않는다.

### 7.3 dependency와 secret 검증

Run:

```powershell
pnpm audit --prod
git ls-files | rg "(^|/)\.env($|\.)|\.pem$|\.key$|credentials|secret"
git diff --check
```

Expected:

- production dependency 취약점은 정책 임계치 이내.
- 실제 `.env`, private key, credential 파일이 추적되지 않음.
- whitespace 오류 없음.

### 7.4 보안 검토 질문

- body가 signer 호출 이후 수정될 수 있는가?
- API가 parser의 원문이 아닌 재직렬화 body를 검증하는 경로가 있는가?
- 새 route가 metadata 없이 기본 scope를 얻는가?
- 브라우저 header가 내부 요청으로 복사되는가?
- 오류나 로그에 금융 body·JWT·cookie가 남는가?
- replay store 장애에서 요청이 허용되는가?
- key rotation 중 이전 private key가 BFF에 불필요하게 남는가?

하나라도 “예” 또는 증명 불가이면 완료하지 않는다.

### 7.5 다음 계획 인계

이 계획이 GREEN이면 다음 독립 계획 `M2 원장 핵심`을 작성한다. 다음 계획의 순서는 다음과 같다.

1. 거래·계좌·카테고리 public contracts.
2. PostgreSQL migration, roles, grants, RLS, indexes.
3. repository transaction과 idempotency/version.
4. Nest controller/service/repository.
5. Next BFF route와 PC React Query 화면.
6. Expo mobile session과 React Query 화면.
7. PC↔mobile 동일 계정 교차 일관성 E2E.

이 인계 시 Task 1~7의 실제 commit SHA, 실행 명령, 통과 개수, hosted 증거 상태를 `docs/roadmap/progress.md`의 기존 형식에 맞춰 기록한다.

## 완료 정의

- exact JSON body를 서명하고 그대로 전송·검증하는 경로가 단위 및 통합 테스트로 증명된다.
- 변경 요청의 method·target·content type·body·request ID·scope 중 하나라도 바뀌면 거부된다.
- replay, duplicate header, oversized body, unsupported method가 fail closed 한다.
- `/api/me`의 기존 인증 동작과 공개 오류 계약이 회귀하지 않는다.
- 실제 secret이나 금융 body가 source, fixture, snapshot, log에 포함되지 않는다.
- 학습 문서가 실제 RED/GREEN 명령과 결과를 설명한다.
- `pnpm verify`, DB test, E2E 상태가 정확히 기록된다.
- TASK 14 hosted E2E가 미완료이면 PR 병합 준비 완료로 주장하지 않는다.
