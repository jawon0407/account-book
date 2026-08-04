# BFF Delegated JWT Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase 사용자 JWT 전달을 제거하고, Vercel BFF가 요청마다 발급하는 30초 ES256 위임 JWT를 Heroku API가 요청 바인딩·scope·일회성 `jti`까지 검증하도록 구현한다.

**Architecture:** BFF는 로컬 app session을 확인한 뒤 고정된 내부 API 요청을 canonicalize하고 ES256 JWT를 한 번만 발급한다. API는 Vercel과 독립적으로 배포한 정적 public-key keyring으로 토큰을 검증하고, PostgreSQL의 `INSERT ... ON CONFLICT DO NOTHING`으로 `jti`를 원자적으로 소비한 뒤에만 principal을 만든다. 현재 보호 API는 body가 없는 `GET /v1/me` 하나이므로 HTTP guard는 빈 body만 허용하며, body가 있는 금융 mutation은 raw-body digest 경계를 별도 승인하기 전 추가하지 않는다.

**Tech Stack:** Node.js 22.15.1, pnpm 11.9.0, TypeScript 6.0.3 strict mode, Next.js 16.2.11 Node.js Route Handlers, NestJS 11.1.28, Fastify 5.10.0, `jose` 6.2.3, PostgreSQL 17, `pg` 8.22.0, Vitest 4.1.10.

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-23-managed-deployment-platform-design.md` §3.1~3.5, §5.3, §7, §11, §12.14~15다.
- BFF는 Supabase access JWT·refresh token·provider token을 Heroku로 전달하지 않는다.
- JWT는 `ES256`, `typ=at+jwt`, exact `iss=urn:account-book:bff`, exact string `aud=urn:account-book:api`, `exp=iat+30`, `nbf=iat`, clock tolerance 최대 5초를 사용한다.
- `sub`는 canonical Supabase user UUID, `sid`는 canonical 로컬 app session UUID, `jti`는 CSPRNG 128-bit base64url, `rid`는 UUID, `scp`는 단일 allowlisted action이다.
- 현재 allowlisted scope는 `me:read` 하나다. 범용 문자열이나 배열 scope를 허용하지 않는다.
- compact JWT와 Authorization token은 각각 최대 4,096 bytes다.
- `rbh`는 uppercase method, canonical path·sorted query, normalized content type, exact body digest와 `rid`를 바인딩한다.
- API는 signature·claim·request binding 검증 후에만 `jti` digest를 DB에 쓰며 같은 `jti`의 동시 요청 중 하나만 성공시킨다.
- replay row의 논리 보존은 `iat+45초`이고 pg_cron cleanup은 매분 실행한다. cron이 없는 환경에서는 배포가 아니라 테스트만 가능하며 production release gate가 실패해야 한다.
- Vercel은 signing private key만, Heroku는 public-key keyring과 accepted `kid` allowlist만 가진다.
- `BFF_AUTH_DISABLED=true` 또는 accepted `kid` 제거는 아직 만료되지 않은 토큰도 즉시 거부한다.
- Vercel Route Handler는 `runtime="nodejs"`, `preferredRegion="iad1"`, `dynamic="force-dynamic"`, `maxDuration=10`을 명시한다.
- API upstream timeout은 3초, BFF 전체 내부 budget은 5초를 넘지 않는다.
- 프런트엔드와 BFF 코드는 `.ts` 또는 `.tsx`만 사용하며 TypeScript strictness를 낮추지 않는다.
- secret, JWT, `jti`, `rbh`, session selector, DB URL과 key material을 로그·오류·assertion diff·문서 증거에 남기지 않는다.
- 각 public class, helper와 보안 경계에는 행동 원리, 보안 이유, 매개변수와 반환값을 설명하는 짧은 JSDoc을 작성한다.
- 구현은 TDD의 RED → GREEN 순서를 지키고 Task마다 별도 검토 가능한 커밋을 만든다.

---

## File Structure

| 경로 | 작업 | 단일 책임 |
|---|---|---|
| `packages/contracts/package.json` | 수정 | server-only 내부 API contract의 명시적 subpath export를 제공한다. |
| `packages/contracts/src/internal-api.ts` | 생성 | scope, canonical target·content type·request binding 문자열의 순수 계약을 소유한다. |
| `packages/contracts/src/internal-api.test.ts` | 생성 | BFF와 API가 공유하는 canonicalization vector를 고정한다. |
| `apps/web/package.json` | 수정 | BFF ES256 서명에 `jose`를 직접 의존한다. |
| `apps/web/src/server/security/delegated-jwt-signer.ts` | 생성 | 요청별 `rid`·`jti`·`rbh`를 만들고 30초 ES256 JWT를 발급한다. |
| `apps/web/src/server/security/delegated-jwt-signer.test.ts` | 생성 | header, claim, TTL, request binding과 secret 비노출을 검증한다. |
| `apps/web/src/server/container.ts` | 수정 | BFF private key와 `kid`를 fail-closed로 파싱해 signer를 주입한다. |
| `apps/web/src/server/container.test.ts` | 수정 | private-key 형식, curve, `kid`, production secret 분리를 검증한다. |
| `apps/web/src/server/http/auth-controller.ts` | 수정 | `/v1/me`에 Supabase JWT 대신 위임 JWT와 token-bound request ID를 보낸다. |
| `apps/web/src/server/http/auth-controller.test.ts` | 수정 | browser·provider token 비전달과 고정 upstream request를 검증한다. |
| `packages/database/src/schema/api.ts` | 생성 | `app_private.api_jwt_replays` Drizzle metadata를 소유한다. |
| `packages/database/src/schema/api.test.ts` | 생성 | digest, expiry와 primary-key 제약을 고정한다. |
| `packages/database/src/index.ts` | 수정 | replay schema를 server package에 export한다. |
| `supabase/migrations/202607230001_delegated_jwt_replay.sql` | 생성 | `app_api`, replay table, 최소 권한과 조건부 pg_cron cleanup을 생성한다. |
| `tests/database/auth-migration.test.ts` | 수정 | 기존 단일 migration suite에서 역할·권한·원자 consume을 실제 검증한다. |
| `tests/database/prepare-auth-e2e.ts` | 수정 | E2E DB 준비에 새 migration과 `app_api` 역할을 포함한다. |
| `apps/api/package.json` | 수정 | replay store용 `pg`와 schema용 workspace package를 직접 의존한다. |
| `apps/api/src/persistence/replay-store.ts` | 생성 | verifier가 사용하는 최소 `consume` port를 정의한다. |
| `apps/api/src/persistence/postgres-replay-store.ts` | 생성 | parameterized atomic insert를 실행하고 row count만 반환한다. |
| `apps/api/src/persistence/postgres-replay-store.test.ts` | 생성 | SQL, digest, expiry, conflict와 오류 비노출을 검증한다. |
| `apps/api/src/environment.ts` | 수정 | static public keyring, accepted `kid`, kill switch와 API DB URL을 파싱한다. |
| `apps/api/src/environment.test.ts` | 수정 | 잘못된 key·curve·allowlist·flag·URL을 fail-closed로 거부한다. |
| `apps/api/src/auth/jwt-verifier.ts` | 교체 | 정적 keyring, exact claim, request binding, replay 순서로 위임 JWT를 검증한다. |
| `apps/api/src/auth/jwt-verifier.test.ts` | 교체 | 전체 positive·negative matrix와 concurrent replay를 검증한다. |
| `apps/api/src/auth/delegated-scope.ts` | 생성 | route별 단일 scope metadata decorator를 제공한다. |
| `apps/api/src/auth/auth.guard.ts` | 수정 | header cardinality, request descriptor와 route scope를 verifier에 전달한다. |
| `apps/api/src/auth/auth.guard.test.ts` | 수정 | Bearer·request ID·scope·body 경계를 검증한다. |
| `apps/api/src/auth/principal.ts` | 수정 | 검증된 user, session, scope와 request ID만 보존한다. |
| `apps/api/src/common/request-context.ts` | 수정 | 인증 성공 후에만 token-bound request ID를 응답 correlation ID로 사용한다. |
| `apps/api/src/common/request-context.test.ts` | 생성 | public route는 inbound ID를 무시하고 인증 route만 verified ID를 사용한다. |
| `apps/api/src/main.ts` | 수정 | Nest shutdown hook을 켜서 API DB pool을 SIGTERM에서 닫는다. |
| `apps/api/src/me/me.controller.ts` | 수정 | `me:read` metadata를 명시한다. |
| `apps/api/src/me/me.module.ts` | 수정 | static verifier와 singleton replay store를 wiring한다. |
| `apps/api/src/me/me.controller.test.ts` | 수정 | 실제 HTTP에서 delegated JWT, replay, binding, kill switch를 검증한다. |
| `apps/web/src/app/api/**/*.ts` | 수정 | 모든 BFF Route Handler의 Node.js runtime·region·duration을 고정한다. |
| `apps/web/src/app/api/route-wiring.test.ts` | 수정 | runtime export와 thin-adapter 정책을 함께 검사한다. |
| `tests/e2e/playwright.config.ts` | 수정 | BFF와 API에 서로 분리된 test signing/public key 환경을 주입한다. |
| `tests/e2e/auth.spec.ts` | 수정 | 기존 로그인·`/api/me`·logout 여정이 새 내부 신뢰 경계에서도 유지되는지 검증한다. |
| `docs/guides/security-auth-testing.md` | 수정 | RED/GREEN, 명령, SHA와 민감값 없는 보안 증거를 한국어·영어로 기록한다. |
| `docs/architecture/backend-authentication.ko.md` | 수정 | Supabase JWT passthrough 제거와 새 신뢰 경계를 한국어로 설명한다. |

---

### Task 1: Canonical delegated-request contract 고정

**Files:**
- Modify: `packages/contracts/package.json`
- Create: `packages/contracts/src/internal-api.ts`
- Create: `packages/contracts/src/internal-api.test.ts`

**Interfaces:**
- Consumes: WHATWG `URL`, Zod 4.
- Produces: `DelegatedScope`, `DelegatedRequestInput`, `canonicalDelegatedRequest()`, 고정 issuer·audience·TTL 상수.

- [ ] **Step 1: canonical vector RED 작성**

`packages/contracts/src/internal-api.test.ts`를 생성한다.

```ts
import { describe, expect, it } from "vitest";
import {
  canonicalDelegatedRequest,
  normalizeDelegatedContentType,
} from "./internal-api.js";

describe("delegated internal API request contract", () => {
  it("sorts query pairs and binds the exact body digest and request ID", () => {
    expect(canonicalDelegatedRequest({
      bodySha256: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      contentType: null,
      method: "GET",
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      target: "/v1/me?z=2&a=1&a=0",
    })).toBe([
      "GET",
      "/v1/me?a=1&a=0&z=2",
      "",
      "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      "123e4567-e89b-42d3-a456-426614174000",
    ].join("\n"));
  });

  it("normalizes only the JSON content types accepted by protected APIs", () => {
    expect(normalizeDelegatedContentType(null)).toBe("");
    expect(normalizeDelegatedContentType("APPLICATION/JSON; CHARSET=UTF-8")).toBe("application/json");
    for (const value of ["text/plain", "application/json; profile=x", "application/json\nx"]) {
      expect(() => normalizeDelegatedContentType(value)).toThrow("DELEGATED_REQUEST_INVALID");
    }
  });

  it.each([
    ["lowercase method", { method: "get" }],
    ["absolute target", { target: "https://evil.test/v1/me" }],
    ["fragment", { target: "/v1/me#x" }],
    ["invalid body digest", { bodySha256: "short" }],
    ["invalid request ID", { requestId: "not-a-uuid" }],
  ])("rejects %s", (_name, override) => {
    expect(() => canonicalDelegatedRequest({
      bodySha256: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      contentType: null,
      method: "GET",
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      target: "/v1/me",
      ...override,
    })).toThrow("DELEGATED_REQUEST_INVALID");
  });
});
```

- [ ] **Step 2: focused RED 확인**

```powershell
pnpm --filter @account-book/contracts test -- internal-api.test.ts
```

Expected: FAIL because `src/internal-api.ts` does not exist. Package-resolution 또는 unrelated test failure는 유효한 RED가 아니다.

- [ ] **Step 3: 순수 canonicalization 구현**

`packages/contracts/src/internal-api.ts`는 Node 전용 module을 import하지 않고 다음 public API를 구현한다.

```ts
import { z } from "zod";

export const DELEGATED_JWT_ISSUER = "urn:account-book:bff";
export const DELEGATED_JWT_AUDIENCE = "urn:account-book:api";
export const DELEGATED_JWT_TTL_SECONDS = 30;
export const DELEGATED_JWT_REPLAY_SECONDS = 45;
export const DELEGATED_JWT_MAX_BYTES = 4096;

export const DelegatedScopeSchema = z.enum(["me:read"]);
export type DelegatedScope = z.infer<typeof DelegatedScopeSchema>;

const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DigestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const RequestIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
);

export type DelegatedRequestInput = Readonly<{
  method: z.infer<typeof MethodSchema>;
  target: string;
  contentType: string | null;
  bodySha256: string;
  requestId: string;
}>;

function invalid(): never {
  throw new Error("DELEGATED_REQUEST_INVALID");
}

/** Normalizes the only content types currently accepted by protected internal APIs. */
export function normalizeDelegatedContentType(value: string | null): "" | "application/json" {
  if (value === null) return "";
  if (Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return invalid();
  const normalized = value.trim().toLowerCase();
  if (normalized === "application/json" || normalized === "application/json; charset=utf-8") return "application/json";
  return invalid();
}

/** Builds the cross-runtime request-binding string without hashing or reading secrets. */
export function canonicalDelegatedRequest(input: DelegatedRequestInput): string {
  const method = MethodSchema.safeParse(input.method);
  const digest = DigestSchema.safeParse(input.bodySha256);
  const requestId = RequestIdSchema.safeParse(input.requestId);
  if (!method.success || !digest.success || !requestId.success || !input.target.startsWith("/")) return invalid();
  let url: URL;
  try {
    url = new URL(input.target, "https://internal.invalid");
  } catch {
    return invalid();
  }
  if (url.origin !== "https://internal.invalid" || url.hash !== "" || url.username !== "" || url.password !== "") return invalid();
  url.searchParams.sort();
  const query = url.searchParams.toString();
  const target = `${url.pathname}${query === "" ? "" : `?${query}`}`;
  return [method.data, target, normalizeDelegatedContentType(input.contentType), digest.data, requestId.data].join("\n");
}
```

`packages/contracts/package.json`에 client root export와 분리된 server contract subpath를 추가한다.

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  },
  "./internal-api": {
    "types": "./dist/internal-api.d.ts",
    "default": "./dist/internal-api.js"
  }
}
```

- [ ] **Step 4: GREEN·typecheck 확인**

```powershell
pnpm --filter @account-book/contracts test -- internal-api.test.ts
pnpm --filter @account-book/contracts typecheck
pnpm --filter @account-book/contracts build
```

Expected: focused tests PASS, typecheck와 build exit 0.

- [ ] **Step 5: Task 1 커밋**

```powershell
git add -- packages/contracts/package.json packages/contracts/src/internal-api.ts packages/contracts/src/internal-api.test.ts
git diff --cached --check
git commit -m "feat: define delegated request contract"
```

---

### Task 2: BFF ES256 signer와 private-key 경계

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/server/security/delegated-jwt-signer.ts`
- Create: `apps/web/src/server/security/delegated-jwt-signer.test.ts`
- Modify: `apps/web/src/server/container.ts`
- Modify: `apps/web/src/server/container.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 1의 `canonicalDelegatedRequest`, `DelegatedScope`, 고정 JWT 상수.
- Produces: `DelegatedJwtSigner.sign(input): Promise<{ requestId: string; token: string }>`와 fail-closed BFF key parser.

- [ ] **Step 1: signer RED 작성**

`apps/web/src/server/security/delegated-jwt-signer.test.ts`에서 process memory의 ES256 key pair로 다음 계약을 먼저 작성한다.

```ts
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { decodeProtectedHeader, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { DelegatedJwtSigner } from "./delegated-jwt-signer.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const now = new Date("2026-07-23T00:00:00.000Z");

describe("DelegatedJwtSigner", () => {
  it("mints one request-bound 30-second ES256 token", async () => {
    const signer = new DelegatedJwtSigner({
      keyId: "bff-2026-07-a",
      privateKey,
      now: () => now,
      randomBytes: () => Buffer.alloc(16, 7),
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    });
    const result = await signer.sign({
      body: new Uint8Array(),
      contentType: null,
      method: "GET",
      scope: "me:read",
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
      target: "/v1/me",
      userId: "123e4567-e89b-42d3-a456-426614174002",
    });
    const verified = await jwtVerify(result.token, createPublicKey(publicKey), {
      algorithms: ["ES256"],
      audience: "urn:account-book:api",
      issuer: "urn:account-book:bff",
    });

    expect(decodeProtectedHeader(result.token)).toEqual({ alg: "ES256", kid: "bff-2026-07-a", typ: "at+jwt" });
    expect(verified.payload).toMatchObject({
      exp: 1_784_764_830,
      iat: 1_784_764_800,
      jti: "BwcHBwcHBwcHBwcHBwcHBw",
      nbf: 1_784_764_800,
      rid: result.requestId,
      scp: "me:read",
      sid: "123e4567-e89b-42d3-a456-426614174001",
      sub: "123e4567-e89b-42d3-a456-426614174002",
    });
    expect(verified.payload.rbh).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.byteLength(result.token, "utf8")).toBeLessThanOrEqual(4096);
  });
});
```

- [ ] **Step 2: signer RED 확인**

```powershell
pnpm --filter @account-book/web test -- delegated-jwt-signer.test.ts
```

Expected: FAIL because signer module and direct `jose` dependency do not exist.

- [ ] **Step 3: signer 최소 구현**

`apps/web/package.json`에 `"jose": "6.2.3"`를 추가하고 `DelegatedJwtSigner`를 다음 interface로 구현한다.

```ts
import { createHash, randomBytes, randomUUID, type KeyObject } from "node:crypto";
import {
  canonicalDelegatedRequest,
  DELEGATED_JWT_AUDIENCE,
  DELEGATED_JWT_ISSUER,
  DELEGATED_JWT_MAX_BYTES,
  DELEGATED_JWT_TTL_SECONDS,
  type DelegatedScope,
} from "@account-book/contracts/internal-api";
import { SignJWT } from "jose";

export type DelegatedSignInput = Readonly<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  target: string;
  contentType: string | null;
  body: Uint8Array;
  scope: DelegatedScope;
  userId: string;
  sessionId: string;
}>;

type SignerDependencies = Readonly<{
  keyId: string;
  privateKey: KeyObject;
  now: () => Date;
  randomBytes?: (size: number) => Buffer;
  randomUUID?: () => string;
}>;

/** Mints a one-request token after binding the exact outbound request representation. */
export class DelegatedJwtSigner {
  public constructor(private readonly dependencies: SignerDependencies) {}

  public async sign(input: DelegatedSignInput): Promise<Readonly<{ requestId: string; token: string }>> {
    const issuedAt = Math.floor(this.dependencies.now().getTime() / 1000);
    const requestId = (this.dependencies.randomUUID ?? randomUUID)();
    const bodySha256 = createHash("sha256").update(input.body).digest("base64url");
    const requestBinding = canonicalDelegatedRequest({
      bodySha256,
      contentType: input.contentType,
      method: input.method,
      requestId,
      target: input.target,
    });
    const rbh = createHash("sha256").update(requestBinding, "utf8").digest("base64url");
    const jti = (this.dependencies.randomBytes ?? randomBytes)(16).toString("base64url");
    const token = await new SignJWT({ rbh, rid: requestId, scp: input.scope, sid: input.sessionId })
      .setProtectedHeader({ alg: "ES256", kid: this.dependencies.keyId, typ: "at+jwt" })
      .setIssuer(DELEGATED_JWT_ISSUER)
      .setAudience(DELEGATED_JWT_AUDIENCE)
      .setSubject(input.userId)
      .setJti(jti)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(issuedAt + DELEGATED_JWT_TTL_SECONDS)
      .sign(this.dependencies.privateKey);
    if (Buffer.byteLength(token, "utf8") > DELEGATED_JWT_MAX_BYTES) throw new Error("DELEGATED_JWT_INVALID");
    return Object.freeze({ requestId, token });
  }
}
```

UUID, `kid`, key type·curve와 finite clock은 constructor에서 한 번 검증한다. 실패 오류는 key value나 JWT를 포함하지 않는 `AUTH_CONFIGURATION_INVALID` 또는 `DELEGATED_JWT_INVALID`만 사용한다.

- [ ] **Step 4: container key parsing RED와 GREEN**

`apps/web/src/server/container.test.ts`에 ES256 private key를 PKCS8 DER base64url로 주입하고 다음 거부 matrix를 추가한다.

```ts
const signingPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signingPrivateKey = signingPair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");

const delegatedEnvironment = {
  BFF_JWT_KEY_ID: "bff-test-a",
  BFF_JWT_PRIVATE_KEY: signingPrivateKey,
} as const;

it.each([
  ["blank kid", { BFF_JWT_KEY_ID: "" }],
  ["unsafe kid", { BFF_JWT_KEY_ID: "key/../../x" }],
  ["non-base64 key", { BFF_JWT_PRIVATE_KEY: "not-a-key" }],
  ["wrong curve", { BFF_JWT_PRIVATE_KEY: p384PrivateKey }],
  ["public key", { BFF_JWT_PRIVATE_KEY: publicKeyDer }],
])("rejects delegated signer configuration: %s", (_name, override) => {
  expect(() => createRequestContainer!({ ...runtimeEnvironment, ...delegatedEnvironment, ...override }))
    .toThrow("AUTH_CONFIGURATION_INVALID");
});
```

`apps/web/src/server/container.ts`에서 `createPrivateKey({ key: Buffer.from(value, "base64url"), format: "der", type: "pkcs8" })`를 사용하고 `asymmetricKeyType === "ec"`, `namedCurve === "prime256v1"`를 확인한다. 생성한 signer를 `AuthController` dependency로 전달한다. test key와 `AUTH_TOKEN_KEY`는 같은 값을 재사용하지 않는다.

- [ ] **Step 5: focused GREEN과 dependency 검증**

```powershell
pnpm install --lockfile-only
pnpm --filter @account-book/web test -- delegated-jwt-signer.test.ts container.test.ts
pnpm --filter @account-book/web typecheck
pnpm audit --prod --audit-level high
```

Expected: focused tests PASS, typecheck와 audit exit 0.

- [ ] **Step 6: Task 2 커밋**

```powershell
git add -- apps/web/package.json apps/web/src/server/security/delegated-jwt-signer.ts apps/web/src/server/security/delegated-jwt-signer.test.ts apps/web/src/server/container.ts apps/web/src/server/container.test.ts pnpm-lock.yaml
git diff --cached --check
git commit -m "feat: mint delegated BFF JWTs"
```

---

### Task 3: `/api/me`에서 Supabase JWT passthrough 제거

**Files:**
- Modify: `apps/web/src/server/http/auth-controller.ts`
- Modify: `apps/web/src/server/http/auth-controller.test.ts`

**Interfaces:**
- Consumes: Task 2의 `DelegatedJwtSigner`, resolved local `userId`·`sessionId`, 고정 `/v1/me`.
- Produces: `Authorization: Bearer <delegated JWT>`, `X-Request-Id: <rid>`, 3초 bounded upstream GET.

- [ ] **Step 1: passthrough 금지 RED 작성**

기존 “uses only the fixed `/v1/me` URL and server JWT” 테스트를 다음 의미로 교체한다. token 원문은 assertion message에 출력하지 않고 public claim만 별도 검증한다.

```ts
it("sends only a request-bound delegated JWT to the fixed current-user endpoint", async () => {
  const subject = setup();
  const response = await subject.controller.me!(request("/api/me?url=https://evil.test", {
    headers: {
      Authorization: "Bearer browser-token",
      Cookie: `__Host-ab_session=${selector}`,
      Forwarded: "host=evil.test",
      Host: "evil.test",
    },
  }));
  expect(response.status).toBe(200);
  const [url, init] = subject.fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  const headers = new Headers(init.headers);
  const delegated = headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";

  expect(url.toString()).toBe("http://api.internal.test:3001/v1/me");
  expect(init.method).toBe("GET");
  expect(headers.get("x-request-id")).toMatch(CANONICAL_UUID);
  expect(delegated).not.toBe("server-access-jwt");
  expect(JSON.stringify(init)).not.toMatch(/browser-token|provider-refresh|cookie|forwarded|evil\.test/iu);
  await expectDelegatedMeToken(delegated, headers.get("x-request-id"));
});
```

- [ ] **Step 2: focused RED 확인**

```powershell
pnpm --filter @account-book/web test -- auth-controller.test.ts
```

Expected: delegated signer 호출과 `X-Request-Id` assertion FAIL. 기존 Supabase access JWT가 Authorization에 남아 있어야 RED가 유효하다.

- [ ] **Step 3: controller forwarding 구현**

`AuthControllerDependencies`에 다음 최소 port를 추가한다.

```ts
delegatedSigner: Readonly<{
  sign(input: Readonly<{
    body: Uint8Array;
    contentType: null;
    method: "GET";
    scope: "me:read";
    sessionId: string;
    target: "/v1/me";
    userId: string;
  }>): Promise<Readonly<{ requestId: string; token: string }>>;
}>;
```

`me()`의 upstream 호출을 다음 순서로 바꾼다.

```ts
const signed = await this.dependencies.delegatedSigner.sign({
  body: new Uint8Array(),
  contentType: null,
  method: "GET",
  scope: "me:read",
  sessionId: resolved.sessionId,
  target: "/v1/me",
  userId: resolved.userId,
});
upstream = await this.fetcher(this.apiMeUrl, {
  method: "GET",
  headers: {
    accept: "application/json",
    authorization: `Bearer ${signed.token}`,
    "x-request-id": signed.requestId,
  },
  signal: AbortSignal.timeout(3_000),
});
```

Supabase token refresh 여부를 판단하기 위한 `accessTokenExpiresAt` 검사는 유지하지만 `resolved.accessToken`은 내부 API request 구성에 사용하지 않는다. abort, signing, fetch 오류는 credential을 포함하지 않는 기존 502 public error로 변환한다.

- [ ] **Step 4: GREEN과 회귀 검사**

```powershell
pnpm --filter @account-book/web test -- auth-controller.test.ts delegated-jwt-signer.test.ts
pnpm --filter @account-book/web typecheck
rg -n 'authorization: `Bearer \\$\\{resolved\\.accessToken\\}`|server-access-jwt' apps/web/src/server/http apps/web/src/server/security
```

Expected: tests PASS, typecheck exit 0, `rg` exit 1로 passthrough 구현이 없어야 한다. Test fixture 문자열은 새 delegated fixture로 교체한다.

- [ ] **Step 5: Task 3 커밋**

```powershell
git add -- apps/web/src/server/http/auth-controller.ts apps/web/src/server/http/auth-controller.test.ts
git diff --cached --check
git commit -m "feat: forward delegated JWT to API"
```

---

### Task 4: PostgreSQL one-time replay store와 `app_api` 최소 권한

**Files:**
- Create: `packages/database/src/schema/api.ts`
- Create: `packages/database/src/schema/api.test.ts`
- Modify: `packages/database/src/index.ts`
- Create: `supabase/migrations/202607230001_delegated_jwt_replay.sql`
- Modify: `tests/database/auth-migration.test.ts`
- Modify: `tests/database/prepare-auth-e2e.ts`
- Modify: `apps/api/package.json`
- Create: `apps/api/src/persistence/replay-store.ts`
- Create: `apps/api/src/persistence/postgres-replay-store.ts`
- Create: `apps/api/src/persistence/postgres-replay-store.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `ReplayStore.consume(jtiDigest: Uint8Array, expiresAt: Date): Promise<boolean>`.
- Database result: first digest insert returns `true`; conflict returns `false`; `app_api`는 LOGIN 가능하지만 schema usage와 replay table insert만 있고 auth table·DDL·delete 권한은 없다. 운영 password는 migration에 넣지 않고 승인된 production secret provisioning에서 별도로 설정한다.

- [ ] **Step 1: schema·migration RED 작성**

`packages/database/src/schema/api.test.ts`를 생성하고 기존 `tests/database/auth-migration.test.ts`가 base migration 직후 새 migration도 적용하도록 확장한다. migration suite를 별도 파일로 분리하지 않아 같은 disposable schema를 병렬 변경하는 경쟁을 방지한다. 실제 DB 테스트는 다음을 검증한다.

```ts
it("allows app_api to consume one digest exactly once", async () => {
  await admin.query("set role app_api");
  try {
    const first = await admin.query(
      "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, now() + interval '45 seconds') on conflict do nothing",
      [Buffer.alloc(32, 7)],
    );
    const replay = await admin.query(
      "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, now() + interval '45 seconds') on conflict do nothing",
      [Buffer.alloc(32, 7)],
    );
    expect(first.rowCount).toBe(1);
    expect(replay.rowCount).toBe(0);
    await expect(admin.query("select * from app_private.auth_sessions")).rejects.toThrow(/permission denied/u);
    await expect(admin.query("delete from app_private.api_jwt_replays")).rejects.toThrow(/permission denied/u);
    await expect(admin.query("create table app_private.api_probe (id integer)")).rejects.toThrow(/permission denied/u);
  } finally {
    await admin.query("reset role");
  }
});
```

- [ ] **Step 2: DB RED 확인**

```powershell
pnpm --filter @account-book/database test -- api.test.ts
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm --filter @account-book/database-tests test -- auth-migration.test.ts
```

Expected: schema file 또는 migration file 부재로 FAIL. 연결 실패는 유효한 RED가 아니다.

- [ ] **Step 3: Drizzle schema와 SQL migration 구현**

`packages/database/src/schema/api.ts`는 다음 table을 정의한다.

```ts
import { sql } from "drizzle-orm/sql";
import { check, customType, pgSchema, timestamp } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const appPrivate = pgSchema("app_private");

export const apiJwtReplays = appPrivate.table(
  "api_jwt_replays",
  {
    jtiDigest: bytea("jti_digest").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("api_jwt_replays_digest_length", sql`octet_length(${table.jtiDigest}) = 32`),
    check("api_jwt_replays_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
```

Migration은 다음 권한과 cleanup을 고정한다.

```sql
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$$;

alter role app_api login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

create table app_private.api_jwt_replays (
  jti_digest bytea primary key check (octet_length(jti_digest) = 32),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint api_jwt_replays_expiry check (expires_at > created_at)
);

revoke all privileges on table app_private.api_jwt_replays from public, anon, authenticated, service_role, app_session_bff, app_api;
grant usage on schema app_private to app_api;
grant insert on table app_private.api_jwt_replays to app_api;

do $$
declare
  existing_job bigint;
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    select jobid into existing_job from cron.job where jobname = 'account-book-api-jwt-replay-cleanup';
    if existing_job is not null then perform cron.unschedule(existing_job); end if;
    perform cron.schedule(
      'account-book-api-jwt-replay-cleanup',
      '* * * * *',
      'delete from app_private.api_jwt_replays where expires_at <= now()'
    );
  end if;
end
$$;
```

`tests/database/prepare-auth-e2e.ts`의 migration 배열에 새 파일을 추가하고 role preparation에 `app_api`를 동일한 최소 권한 LOGIN role로 생성한다. 이 disposable DB에서만 고정 synthetic password를 설정해 API가 `app_api`로 접속하게 하고, production password나 owner credential은 사용하지 않는다. production smoke는 `cron.job`에 정확한 job name과 매분 schedule이 없으면 실패해야 한다.

```sql
alter role app_api password 'account-book-e2e-only';
```

이 문장은 exact local disposable database URL 검증을 통과한 `prepareAuthE2e()` 안에서만 실행한다. 일반 migration과 production provisioning에는 이 password 문자열을 포함하지 않는다.

- [ ] **Step 4: replay port와 PostgreSQL adapter RED 작성**

`apps/api/src/persistence/postgres-replay-store.test.ts`에 query mock으로 다음을 고정한다.

```ts
it("uses one parameterized insert and returns the affected-row decision", async () => {
  const query = vi.fn()
    .mockResolvedValueOnce({ rowCount: 1 })
    .mockResolvedValueOnce({ rowCount: 0 });
  const end = vi.fn(async () => undefined);
  const store = new PostgresReplayStore({ end, query });
  const digest = new Uint8Array(32).fill(7);
  const expiresAt = new Date("2026-07-23T00:00:45.000Z");

  await expect(store.consume(digest, expiresAt)).resolves.toBe(true);
  await expect(store.consume(digest, expiresAt)).resolves.toBe(false);
  expect(query).toHaveBeenCalledWith(expect.objectContaining({
    text: expect.stringMatching(/insert into app_private\\.api_jwt_replays[\\s\\S]*on conflict do nothing/iu),
    values: [Buffer.from(digest), expiresAt],
  }));
  await store.onApplicationShutdown();
  expect(end).toHaveBeenCalledOnce();
});
```

- [ ] **Step 5: adapter 구현과 DB GREEN**

`ReplayStore`와 adapter를 다음 signature로 구현한다.

```ts
export const REPLAY_STORE = Symbol("REPLAY_STORE");

export interface ReplayStore {
  /** Atomically consumes one hashed token ID until its expiry. */
  consume(jtiDigest: Uint8Array, expiresAt: Date): Promise<boolean>;
}
```

```ts
import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

export class PostgresReplayStore implements ReplayStore, OnApplicationShutdown {
  public constructor(private readonly database: Pick<Pool, "end" | "query">) {}

  public async consume(jtiDigest: Uint8Array, expiresAt: Date): Promise<boolean> {
    if (jtiDigest.byteLength !== 32 || !Number.isFinite(expiresAt.getTime())) throw new Error("REPLAY_INPUT_INVALID");
    const result = await this.database.query({
      name: "consume-api-jwt-replay",
      text: "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, $2) on conflict do nothing",
      values: [Buffer.from(jtiDigest), expiresAt],
    });
    return result.rowCount === 1;
  }

  /** Closes the process-owned API pool during Nest shutdown. */
  public async onApplicationShutdown(): Promise<void> {
    await this.database.end();
  }
}
```

DB 오류를 token-invalid로 오인하지 않고 fixed operational 503으로 올려보낸다. query 또는 error를 로그에 기록하지 않는다.

- [ ] **Step 6: Task 4 전체 검증**

```powershell
pnpm install --lockfile-only
pnpm --filter @account-book/database test
pnpm --filter @account-book/api test -- postgres-replay-store.test.ts
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm --filter @account-book/database-tests test -- auth-migration.test.ts
pnpm --filter @account-book/database-tests prepare:e2e
pnpm --filter @account-book/database typecheck
pnpm --filter @account-book/api typecheck
```

Expected: schema, adapter, real PostgreSQL tests PASS; typecheck와 prepare command exit 0.

- [ ] **Step 7: Task 4 커밋**

```powershell
git add -- packages/database/src/schema/api.ts packages/database/src/schema/api.test.ts packages/database/src/index.ts supabase/migrations/202607230001_delegated_jwt_replay.sql tests/database/auth-migration.test.ts tests/database/prepare-auth-e2e.ts apps/api/package.json apps/api/src/persistence/replay-store.ts apps/api/src/persistence/postgres-replay-store.ts apps/api/src/persistence/postgres-replay-store.test.ts pnpm-lock.yaml
git diff --cached --check
git commit -m "feat: add delegated JWT replay store"
```

---

### Task 5: Heroku static keyring verifier와 전체 JWT negative matrix

**Files:**
- Modify: `apps/api/src/environment.ts`
- Modify: `apps/api/src/environment.test.ts`
- Replace: `apps/api/src/auth/jwt-verifier.ts`
- Replace: `apps/api/src/auth/jwt-verifier.test.ts`
- Modify: `apps/api/src/auth/principal.ts`

**Interfaces:**
- Consumes: Task 1 canonical contract, Task 4 `ReplayStore`, raw compact token과 verified HTTP request descriptor.
- Produces: `DelegatedJwtVerifier.verify(input): Promise<AuthPrincipal>`.

- [ ] **Step 1: environment RED 작성**

기존 remote JWKS 환경을 제거하는 기대값을 먼저 작성한다.

```ts
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const required = {
  API_DATABASE_URL: "postgresql://app_api:secret@db.example.test:5432/account_book?sslmode=require",
  BFF_AUTH_DISABLED: "false",
  BFF_JWT_ACCEPTED_KIDS: JSON.stringify(["bff-2026-07-a"]),
  BFF_JWT_PUBLIC_KEYS: JSON.stringify({ "bff-2026-07-a": publicKey }),
};

expect(parseApiEnvironment(required)).toMatchObject({
  bffAuthDisabled: false,
  acceptedKids: new Set(["bff-2026-07-a"]),
  apiDatabaseUrl: required.API_DATABASE_URL,
});
```

잘못된 JSON, 빈 allowlist, allowlist에 없는 key, P-384/RSA/private key, duplicate `kid`, `BFF_AUTH_DISABLED`의 `"TRUE"`·`"1"`, public HTTP DB proxy URL을 모두 `API_CONFIGURATION_INVALID`로 거부한다.

- [ ] **Step 2: verifier RED matrix 작성**

`apps/api/src/auth/jwt-verifier.test.ts`는 local ES256 pair, deterministic clock와 in-memory replay fake를 사용한다. 다음 케이스를 각각 고정한다.

```ts
it.each([
  "missing exp",
  "expired",
  "future iat",
  "future nbf",
  "lifetime over 30 seconds",
  "nbf different from iat",
  "wrong typ",
  "wrong alg",
  "unknown kid",
  "unaccepted kid",
  "crit present",
  "wrong issuer",
  "wrong audience",
  "audience array",
  "wrong scope",
  "scope array",
  "invalid sub UUID",
  "invalid sid UUID",
  "invalid rid UUID",
  "short jti",
  "noncanonical jti",
  "invalid rbh",
  "request method mismatch",
  "request target mismatch",
  "content type mismatch",
  "body digest mismatch",
  "request ID mismatch",
  "token over 4096 bytes",
])("rejects %s without consuming replay state", async (caseName) => {
  const { token, request } = await invalidCase(caseName);
  await expect(verifier.verify({ token, request, requiredScope: "me:read" }))
    .rejects.toThrow("AUTH_ACCESS_TOKEN_INVALID");
  expect(replayStore.consume).not.toHaveBeenCalled();
});
```

같은 valid token을 동시에 두 번 검증하면 `consume` 결과 `[true, false]`에 따라 정확히 하나만 principal을 반환한다. replay store가 throw하면 detail 없는 operational error가 올라오고 invalid token으로 바뀌지 않아야 한다. `BFF_AUTH_DISABLED=true`는 key resolve와 replay call 전에 fixed operational error로 실패해야 한다.

- [ ] **Step 3: verifier RED 확인**

```powershell
pnpm --filter @account-book/api test -- environment.test.ts jwt-verifier.test.ts
```

Expected: remote JWKS interface와 old `session_id` claim 때문에 FAIL.

- [ ] **Step 4: static keyring과 exact verifier 구현**

환경 parser는 SPKI DER base64url을 `createPublicKey`로 읽고 `ec`·`prime256v1` public key만 frozen `ReadonlyMap<string, KeyObject>`에 저장한다. accepted set은 keyring의 부분집합이어야 하며 최대 3개 key를 허용한다. old `AUTH_JWKS_URL`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_JWT_ALGORITHM`은 제거한다.

Verifier input과 principal을 다음처럼 고정한다.

```ts
export type DelegatedRequestDescriptor = Readonly<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  target: string;
  contentType: string | null;
  body: Uint8Array;
  requestId: string;
}>;

export type VerifyDelegatedTokenInput = Readonly<{
  token: string;
  request: DelegatedRequestDescriptor;
  requiredScope: DelegatedScope;
}>;

export type AuthPrincipal = Readonly<{
  userId: string;
  sessionId: string;
  scope: DelegatedScope;
  requestId: string;
}>;
```

검증 순서는 다음 code path로 고정한다.

```ts
if (policy.disabled) throw new AccessTokenVerificationUnavailableError();
if (Buffer.byteLength(input.token, "utf8") > DELEGATED_JWT_MAX_BYTES) throw new InvalidAccessTokenError();
const header = decodeProtectedHeader(input.token);
if (header.alg !== "ES256" || header.typ !== "at+jwt" || header.crit !== undefined
  || typeof header.kid !== "string" || !policy.acceptedKids.has(header.kid)) {
  throw new InvalidAccessTokenError();
}
const key = policy.keys.get(header.kid);
if (key === undefined) throw new InvalidAccessTokenError();
const { payload } = await jwtVerify(input.token, key, {
  algorithms: ["ES256"],
  audience: DELEGATED_JWT_AUDIENCE,
  issuer: DELEGATED_JWT_ISSUER,
  clockTolerance: 5,
  currentDate: policy.now(),
  requiredClaims: ["aud", "exp", "iat", "iss", "jti", "nbf", "rbh", "rid", "scp", "sid", "sub"],
});
```

그 다음 `payload.aud`가 배열이 아닌 exact string인지, 모든 time이 integer이고 `nbf===iat`, `exp===iat+30`인지, UUID·scope·digest·128-bit `jti` 형식인지 검사한다. BFF와 같은 canonical request를 SHA-256한 값이 `rbh`와 timing-safe하게 일치한 뒤 `sha256(jti)`와 `new Date((iat+45)*1000)`로 `replayStore.consume()`을 호출한다. `false`는 invalid token, DB throw는 operational error다.

- [ ] **Step 5: verifier GREEN과 old trust 제거 확인**

```powershell
pnpm --filter @account-book/api test -- environment.test.ts jwt-verifier.test.ts
pnpm --filter @account-book/api typecheck
rg -n 'createRemoteJWKSet|AUTH_JWKS_URL|session_id|Supabase JWKS' apps/api/src
```

Expected: focused tests PASS, typecheck exit 0, `rg` exit 1.

- [ ] **Step 6: Task 5 커밋**

```powershell
git add -- apps/api/src/environment.ts apps/api/src/environment.test.ts apps/api/src/auth/jwt-verifier.ts apps/api/src/auth/jwt-verifier.test.ts apps/api/src/auth/principal.ts
git diff --cached --check
git commit -m "feat: verify delegated API JWTs"
```

---

### Task 6: HTTP scope·request-binding guard와 API wiring

**Files:**
- Create: `apps/api/src/auth/delegated-scope.ts`
- Modify: `apps/api/src/auth/auth.guard.ts`
- Modify: `apps/api/src/auth/auth.guard.test.ts`
- Modify: `apps/api/src/common/request-context.ts`
- Create: `apps/api/src/common/request-context.test.ts`
- Modify: `apps/api/src/common/api-error.filter.ts`
- Modify: `apps/api/src/common/api-error.filter.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/me/me.controller.ts`
- Modify: `apps/api/src/me/me.module.ts`
- Modify: `apps/api/src/me/me.controller.test.ts`

**Interfaces:**
- Consumes: Task 5 verifier, Task 4 replay store, Nest `Reflector`.
- Produces: `@RequireDelegatedScope("me:read")`, verified request principal, token-bound correlation ID.

- [ ] **Step 1: guard RED 작성**

`AuthGuard` tests에 exact one `Authorization`, exact one `X-Request-Id`, route metadata와 empty-body restriction을 추가한다.

```ts
it("passes one bounded request descriptor and exact route scope to the verifier", async () => {
  const verify = vi.fn(async () => principal);
  const reflector = { getAllAndOverride: vi.fn(() => "me:read") };
  const guard = new AuthGuard({ verify }, reflector as never);
  const incoming = request({
    method: "GET",
    rawHeaders: [
      "Authorization", "Bearer aaa.bbb.ccc",
      "X-Request-Id", principal.requestId,
    ],
    url: "/v1/me?z=2&a=1",
  });

  await expect(guard.canActivate(context(incoming))).resolves.toBe(true);
  expect(verify).toHaveBeenCalledWith({
    requiredScope: "me:read",
    request: {
      body: new Uint8Array(),
      contentType: null,
      method: "GET",
      requestId: principal.requestId,
      target: "/v1/me?z=2&a=1",
    },
    token: "aaa.bbb.ccc",
  });
});
```

누락·중복·coalesced request ID, invalid UUID, missing scope metadata, unsupported method, content type가 있는 GET, nonzero content-length와 transfer-encoding은 verifier 호출 전에 거부한다.

- [ ] **Step 2: HTTP RED 확인**

```powershell
pnpm --filter @account-book/api test -- auth.guard.test.ts request-context.test.ts me.controller.test.ts
```

Expected: scope decorator와 request descriptor 부재로 FAIL.

- [ ] **Step 3: scope decorator와 guard 구현**

`apps/api/src/auth/delegated-scope.ts`를 생성한다.

```ts
import type { DelegatedScope } from "@account-book/contracts/internal-api";
import { SetMetadata } from "@nestjs/common";

export const DELEGATED_SCOPE_METADATA = "account-book:delegated-scope";

/** Declares the single delegated action accepted by one protected route. */
export const RequireDelegatedScope = (scope: DelegatedScope): MethodDecorator =>
  SetMetadata(DELEGATED_SCOPE_METADATA, scope);
```

Guard는 `Reflector.getAllAndOverride()`로 handler와 class metadata를 읽는다. 현재 raw-body capture 경계가 없으므로 보호 route는 `GET`, no `Content-Type`, no `Transfer-Encoding`, `Content-Length` absent 또는 exact `"0"`만 허용한다. 다른 method·body는 401 fail-closed이며 새 금융 mutation을 만들기 전에 별도 raw-body plan을 요구한다.

`MeController.me()`에 `@RequireDelegatedScope("me:read")`를 추가한다.

- [ ] **Step 4: verified correlation ID 구현**

`request-context.ts`의 `onRequest`는 외부 `X-Request-Id`를 계속 무시하고 local UUID를 만든다. `onSend` hook은 `request.principal?.requestId ?? request.id`를 response `X-Request-Id`로 사용한다. 따라서 public health와 invalid auth는 attacker ID를 반영하지 않고, fully verified request만 BFF `rid`와 상관된다.

`ApiErrorFilter`도 exception이 verification 뒤 controller에서 발생한 경우에만 `request.principal.requestId`를 사용하고 그 전에는 `request.id`를 사용한다. 둘 다 canonical UUID가 아니면 새 local UUID를 만든다.

- [ ] **Step 5: module wiring과 real HTTP GREEN**

`MeModule`은 process-wide `pg.Pool`을 `API_DATABASE_URL`로 한 번 생성해 `max:5`, `connectionTimeoutMillis:2_000`, `idleTimeoutMillis:10_000`, `allowExitOnIdle:true`를 사용한다. public keyring verifier에는 같은 process snapshot의 keys, accepted kids, kill switch와 `PostgresReplayStore`를 주입한다.

`main.ts`는 listen 전에 `app.enableShutdownHooks()`를 호출한다. 따라서 Heroku SIGTERM과 test `app.close()`가 `PostgresReplayStore.onApplicationShutdown()`을 실행하고 새 query를 받기 전에 pool을 닫는다.

`me.controller.test.ts`는 실제 signed token에 request-bound header를 보내고 다음을 검증한다.

```ts
const first = await app.inject({
  method: "GET",
  url: "/v1/me",
  headers: {
    authorization: `Bearer ${validToken}`,
    "x-request-id": requestId,
  },
});
const replay = await app.inject({
  method: "GET",
  url: "/v1/me",
  headers: {
    authorization: `Bearer ${validToken}`,
    "x-request-id": requestId,
  },
});
expect(first.statusCode).toBe(200);
expect(first.headers["x-request-id"]).toBe(requestId);
expect(replay.statusCode).toBe(401);
```

같은 token의 method·query·request ID 변경은 replay store를 소비하기 전에 401이어야 한다. Supabase-format token, browser Bearer, missing JWT, CORS preflight는 모두 실패해야 한다. kill switch verifier는 503이며 token/key detail을 body에 포함하지 않는다.

- [ ] **Step 6: API focused·integration 검증**

```powershell
pnpm --filter @account-book/api test -- auth.guard.test.ts request-context.test.ts api-error.filter.test.ts me.controller.test.ts
pnpm --filter @account-book/api typecheck
pnpm --filter @account-book/api build
```

Expected: focused tests PASS, typecheck와 build exit 0.

- [ ] **Step 7: Task 6 커밋**

```powershell
git add -- apps/api/src/auth/delegated-scope.ts apps/api/src/auth/auth.guard.ts apps/api/src/auth/auth.guard.test.ts apps/api/src/common/request-context.ts apps/api/src/common/request-context.test.ts apps/api/src/common/api-error.filter.ts apps/api/src/common/api-error.filter.test.ts apps/api/src/main.ts apps/api/src/me/me.controller.ts apps/api/src/me/me.module.ts apps/api/src/me/me.controller.test.ts
git diff --cached --check
git commit -m "feat: enforce delegated API request scope"
```

---

### Task 7: Vercel runtime 고정, E2E와 보안 증거 확정

**Files:**
- Modify: all `apps/web/src/app/api/**/route.ts`
- Modify: `apps/web/src/app/api/route-wiring.test.ts`
- Modify: `tests/e2e/playwright.config.ts`
- Modify: `tests/e2e/auth.spec.ts`
- Modify: `docs/guides/security-auth-testing.md`
- Modify: `docs/architecture/backend-authentication.ko.md`
- Modify: `docs/superpowers/specs/2026-07-23-managed-deployment-platform-design.md`

**Interfaces:**
- Consumes: Task 1~6의 signer, verifier, migration과 existing authentication E2E.
- Produces: Node.js runtime evidence, full `/api/me` journey, 동일 SHA CI 증거와 spec 상태 갱신.

- [ ] **Step 1: route runtime policy RED 작성**

`route-wiring.test.ts`의 각 route source 검사에 다음 assertion을 추가한다.

```ts
expect(source).toContain('export const runtime = "nodejs"');
expect(source).toContain('export const preferredRegion = "iad1"');
expect(source).toContain('export const dynamic = "force-dynamic"');
expect(source).toContain("export const maxDuration = 10");
expect(source).not.toMatch(/runtime\\s*=\\s*["']edge["']|globalThis\\.EdgeRuntime/u);
```

- [ ] **Step 2: runtime RED 확인**

```powershell
pnpm --filter @account-book/web test -- route-wiring.test.ts
```

Expected: 모든 route가 네 export 중 하나 이상 누락해 FAIL.

- [ ] **Step 3: 모든 BFF route에 runtime 상수 추가**

각 `route.ts`에 동일한 네 줄을 추가한다.

```ts
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
```

route adapter의 thin-controller 책임과 method allowlist는 변경하지 않는다.

- [ ] **Step 4: E2E test key와 replay 여정 구현**

`playwright.config.ts`는 config process에서 P-256 key pair를 한 번 생성한다. private key의 PKCS8 DER base64url은 web server environment의 `BFF_JWT_PRIVATE_KEY`에만, public key의 SPKI DER base64url은 API environment의 `BFF_JWT_PUBLIC_KEYS`에만 전달한다. 두 runtime에 같은 private secret을 복제하지 않고 E2E 종료 후 key material을 파일·trace에 쓰지 않는다.

API web server에는 `API_DATABASE_URL=postgresql://app_api:account-book-e2e-only@127.0.0.1:5432/account_book_test`, `BFF_AUTH_DISABLED=false`, `BFF_JWT_ACCEPTED_KIDS=["e2e-bff-a"]`를 주입한다. 이 password는 `prepare-auth-e2e.ts`가 disposable local role에만 설정하는 synthetic 값이며 production secret으로 재사용하지 않는다.

`auth.spec.ts`는 정상 로그인 후 `/api/me` 200과 logout 뒤 selector replay 401을 유지한다. API direct token은 browser response에 노출되지 않으므로 E2E가 token 자체를 추출하거나 로그로 남기지 않는다. delegated token의 one-time replay 동작은 Task 5·6 API integration과 Task 4 DB integration이 소유한다.

- [ ] **Step 5: focused와 전체 로컬 검증**

```powershell
pnpm setup:hooks
pnpm run verify
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm test:db
pnpm --filter @account-book/database-tests prepare:e2e
pnpm --filter @account-book/e2e test
pnpm audit --prod --audit-level high
git diff --check
```

Expected: verify, DB, E2E, audit와 diff check exit 0. PostgreSQL 또는 Chromium이 없으면 성공으로 표시하지 않고 동일 code SHA의 CI 결과로만 대체한다.

- [ ] **Step 6: code SHA push와 동일 SHA CI 확인**

```powershell
$codeSha = git rev-parse HEAD
git push origin feature/security-auth-foundation
$run = gh run list --branch feature/security-auth-foundation --workflow security-gate --limit 1 --json databaseId,headSha,url | ConvertFrom-Json
if ($run.headSha -ne $codeSha) { throw 'The newest security-gate run does not target the code commit.' }
gh run watch $run.databaseId --exit-status
```

Expected: run head SHA가 `$codeSha`와 일치하고 `security-gate` success. 실패하면 문서 상태를 바꾸지 않고 `superpowers:systematic-debugging`으로 원인을 조사한다.

- [ ] **Step 7: 한국어·영어 보안 증거 문서화**

`docs/guides/security-auth-testing.md`에 다음 사실과 실제 관찰값을 기록한다.

```markdown
## BFF delegated JWT trust boundary

- RED: BFF가 Supabase user access JWT를 `/v1/me`에 전달했고 API가 remote Supabase JWKS와 `session_id`를 검증했다.
- GREEN: BFF-minted ES256, 30초 TTL, exact `iss`·`aud`, route scope, request binding, one-time replay store와 independent kill switch를 같은 code SHA에서 검증했다.
- Secret evidence policy: compact JWT, `jti`, `rbh`, key material, selector와 DB URL은 출력·artifact·문서에 저장하지 않았다.
- Production blocker: Supabase `cron.job`에 `account-book-api-jwt-replay-cleanup`이 없거나 key rotation·`BFF_AUTH_DISABLED` drill이 미실행이면 출시하지 않는다.
```

같은 절을 짧은 영어로 추가한다. 실행한 command, 실제 pass/fail count, code SHA와 GitHub run URL만 기록하고 관찰하지 않은 숫자는 추정하지 않는다.

`docs/architecture/backend-authentication.ko.md`에는 browser → Vercel opaque cookie, Vercel → Heroku delegated JWT, Heroku → PostgreSQL replay consume 신뢰 경계를 갱신한다.

`docs/superpowers/specs/2026-07-23-managed-deployment-platform-design.md`에서는 §12.14만 `구현 및 자동 검증 완료`로 표시한다. production key rotation·kill-switch drill과 pg_cron 실제 증거가 없으면 운영 완료로 표시하지 않는다.

- [ ] **Step 8: 문서 검사와 커밋**

```powershell
$unresolved = @('TO' + 'DO', 'TB' + 'D', 'FIX' + 'ME', '추후 ' + '결정', '나중에 ' + '결정')
foreach ($pattern in $unresolved) {
  rg -n --fixed-strings $pattern docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/superpowers/specs/2026-07-23-managed-deployment-platform-design.md
  if ($LASTEXITCODE -eq 0) { throw "Unresolved documentation marker found." }
}
git diff --check
git add -- apps/web/src/app/api tests/e2e/playwright.config.ts tests/e2e/auth.spec.ts docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/superpowers/specs/2026-07-23-managed-deployment-platform-design.md
git diff --cached --check
git commit -m "docs: record delegated JWT evidence"
```

Expected: placeholder `rg`는 exit 1, diff checks는 출력 없이 exit 0, runtime·E2E·문서만 포함한 commit이 생성된다.

- [ ] **Step 9: 최종 SHA CI와 상태 확인**

```powershell
$finalSha = git rev-parse HEAD
git push origin feature/security-auth-foundation
$finalRun = gh run list --branch feature/security-auth-foundation --workflow security-gate --limit 1 --json databaseId,headSha,url | ConvertFrom-Json
if ($finalRun.headSha -ne $finalSha) { throw 'The newest security-gate run does not target the final commit.' }
gh run watch $finalRun.databaseId --exit-status
git status --short --branch
```

Expected: final SHA의 `security-gate`가 success. 기존에 사용자가 보유한 unrelated working changes가 있으면 clean이라고 주장하지 않고 파일 목록을 그대로 보고한다.

---

## Plan Self-Review Record

- Spec coverage: JWT 발급자, 30초 TTL, exact claim, `jti`, request binding, key rotation 전제, kill switch, Node.js runtime, DB 최소 권한, replay cleanup, negative tests와 release gate를 Task 1~7에 매핑했다.
- Scope split: BFF 인증 abuse limiter, Google·Kakao·Naver live provider matrix, PWA service-worker 저장 정책, 전체 금융 mutation body hashing은 독립적으로 검토 가능한 후속 계획으로 남겼다. 이번 계획은 해당 기능을 암묵적으로 구현했다고 표시하지 않는다.
- Trust separation: Vercel은 private key, Heroku는 static public keyring·accepted `kid`, PostgreSQL은 hashed `jti`만 갖는다. Heroku는 BFF의 JWKS URL을 조회하지 않는다.
- Replay ordering: signature·header·claim·scope·request binding을 모두 통과한 뒤 atomic consume을 수행하므로 invalid 입력이 replay table을 채울 수 없다.
- HTTP body boundary: 현재 보호 route가 GET 하나라는 실제 코드 상태를 반영해 empty body만 허용한다. raw-body capture가 없는 상태에서 금융 mutation을 허용하지 않는다.
- Type consistency: `DelegatedScope`, `DelegatedRequestDescriptor`, `ReplayStore.consume`, `DelegatedJwtSigner.sign`, `AuthPrincipal.requestId` 이름과 형식을 모든 Task에서 동일하게 사용했다.
- Secret safety: test는 key를 process memory에서 생성하고 compact JWT·key·selector 원문을 assertion diff, log, trace와 문서에 남기지 않는다.
- No placeholders: 실행 시 관찰해야 하는 SHA·run URL·pass count는 출처와 기록 규칙으로 명시했고 가짜 값이나 미래 성공 상태를 문서에 넣지 않는다.
