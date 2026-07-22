# Security Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저에 인증 토큰을 노출하지 않는 PostgreSQL 불투명 세션 기반으로 이메일·Google·Kakao·Naver 인증 수직 슬라이스를 구현한다.

**Architecture:** 브라우저는 `ky`로 same-origin Next.js BFF만 호출하고, BFF가 Supabase Auth token을 암호화해 PostgreSQL 비공개 스키마에 저장한다. BFF가 서버 간 요청에만 access JWT를 사용하며 NestJS/Fastify API는 JWKS와 claim을 독립 검증한다. 자동 테스트는 Auth port의 fake를 사용하고 PostgreSQL 권한·migration은 격리된 PostgreSQL CI service에서 검증하며 실제 OAuth는 개발용 Supabase smoke test로 분리한다.

**Tech Stack:** Node.js 22.15.1, pnpm 11.9.0, TypeScript 6.0.3, Next.js 16.2.10, React 19.2.7, NestJS 11.1.28, Fastify 5.10.0, Supabase JS 2.110.7, PostgreSQL, Drizzle ORM 0.45.2, Zod 4.4.3, ky 2.0.2, TanStack Query 5.101.2, jose 6.2.3, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- 모든 프런트엔드 소스는 `.ts` 또는 `.tsx`이며 TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 사용한다.
- 브라우저는 Supabase와 NestJS API를 직접 호출하지 않고 same-origin BFF만 호출한다.
- access token, refresh token, service credential과 DB credential은 client bundle, browser storage, URL, response body와 로그에 포함하지 않는다.
- 브라우저에는 `__Host-ab_session`과 로그인 전 `__Host-ab_interaction` 불투명 HttpOnly cookie만 저장한다.
- session selector는 256비트 난수이고 DB에는 SHA-256 hash만 저장한다.
- token envelope는 AES-256-GCM, 96비트 IV, versioned key ID와 AAD를 사용하며 복호화 실패는 fail closed다.
- 애플리케이션이 시작하는 상태 변경은 CSRF token, exact Origin과 Fetch Metadata 검증을 통과한 POST에서만 실행한다.
- OAuth·이메일 확인·복구 callback GET은 state 또는 일회용 code, PKCE, interaction binding, 만료와 단일 소비를 검증한다.
- 인증 응답과 사용자별 응답은 `Cache-Control: private, no-store`다.
- 보안 관련 exported 함수·class에는 행동 원리, 매개변수, 반환값과 실패 조건을 설명하는 TSDoc을 작성한다.
- 주석은 구현을 반복 설명하지 않고 검증 순서, 불변 조건과 fail-closed 이유를 기록한다.
- 관리자 페이지, 거래 기능, 로그인 공급자 연결·해제와 동일 이메일 자동 병합은 이 계획에 포함하지 않는다.
- 실제 OAuth secret은 저장소에 기록하지 않으며 개발용 공급자 smoke test 전에는 운영 준비 완료로 표시하지 않는다.
- 각 task는 RED → GREEN → REFACTOR를 확인하고 집중 테스트와 전체 회귀 테스트 결과를 기록한다.
- 치명적·높음 보안 위험, 인증 회귀, secret scan 실패 또는 DB 권한 검증 실패가 있으면 병합하지 않는다.
- Ponytail `full` ladder를 적용한다. 기존 코드 → Node/Web/PostgreSQL native 기능 → 이미 필요한 dependency 순서로 재사용하고, 보안·접근성·명시 요구가 아닌 단일 구현 abstraction과 미래용 scaffolding은 만들지 않는다.

## File Map

| 영역 | 파일 | 책임 |
| --- | --- | --- |
| Workspace | `package.json`, `pnpm-lock.yaml`, `tsconfig.base.json`, `eslint.config.mjs` | 고정 버전, 공통 명령과 strict 품질 기준 |
| Contracts | `packages/contracts/src/auth.ts`, `errors.ts`, `index.ts` | framework 독립 인증 schema와 type |
| Database | `packages/database/src/schema/auth.ts`, `client.ts`, `index.ts` | Drizzle schema와 server-only DB client |
| Migration | `supabase/migrations/202607200001_security_auth_foundation.sql` | private schema, table, constraint, role와 grant |
| Web security | `apps/web/src/server/security/*.ts` | selector, encryption, cookie, CSRF, request 검증 |
| Web persistence | `apps/web/src/server/persistence/auth-repository.ts`, `postgres-auth-repository.ts` | session·OAuth·recovery·rate-limit의 단일 DB 경계 |
| Web session | `apps/web/src/server/session/session-service.ts` | session 생성·조회·회전·폐기 정책 |
| Web auth | `apps/web/src/server/auth/*.ts` | Supabase port·adapter, email·OAuth·recovery use case |
| BFF | `apps/web/src/app/api/auth/**/route.ts` | HTTP를 검증된 use case 호출로 변환 |
| Web client | `apps/web/src/lib/http/*.ts`, `src/queries/auth.ts` | ky, CSRF와 TanStack Query |
| Web UI | `apps/web/src/app/(auth)/**`, `src/components/auth/**`, `src/app/globals.css` | 접근 가능한 반응형 인증 화면과 상태 motion |
| API | `apps/api/src/auth/*.ts`, `src/me/*.ts`, `src/main.ts` | JWT 검증, guard와 `/v1/me` |
| Tests | 각 source 인접 `*.test.ts`, `tests/e2e/auth.spec.ts`, `tests/database/auth-migration.test.ts` | 단위·통합·E2E·DB 권한 증거 |
| Docs | `docs/architecture/adr/0001-opaque-auth-sessions.md`, `docs/guides/auth-environment.md`, `docs/guides/security-auth-testing.md` | 결정, secret 경계와 RED/GREEN 증거 |

---

### Task 1: UTF-8 보안 문서 기준 복구

**Files:**
- Modify: `.github/pull_request_template.md`
- Modify: `scripts/security/workflow-policy.test.mjs`
- Modify: `docs/guides/testing.md`

**Interfaces:**
- Consumes: 기존 Node test runner와 workflow policy test.
- Produces: 사람이 읽을 수 있는 한국어 PR 보안 checklist와 RED/GREEN guide.

- [ ] **Step 1: 올바른 한국어 문구를 기대하는 실패 테스트 작성**

`scripts/security/workflow-policy.test.mjs`의 마지막 테스트가 다음 핵심 문구를 UTF-8 문자열로 요구하도록 바꾼다.

```js
test("pull request template keeps its Korean policy evidence in UTF-8", () => {
  const source = readFileSync(pullRequestTemplatePath, "utf8");
  const lines = source.split(/\r?\n/u);
  const requiredLines = [
    "## 변경 목적과 범위",
    "## 검증 증거",
    "## 보안 영향",
    "## 데이터베이스와 롤백",
    "## 알려진 잔여 위험",
    "- [ ] PR head SHA와 CI가 검사한 SHA가 같다.",
  ];

  for (const line of requiredLines) {
    assert.ok(lines.includes(line), `missing UTF-8 policy line: ${line}`);
  }
  assert.doesNotMatch(source, /[蹂紐寃]/u);
});
```

- [ ] **Step 2: RED 확인**

Run: `node --test scripts/security/workflow-policy.test.mjs`

Expected: FAIL, `missing UTF-8 policy line: ## 변경 목적과 범위`.

- [ ] **Step 3: PR template과 testing guide를 올바른 UTF-8 한국어로 교체**

PR template에는 변경 목적·포함/제외 범위, 실행 명령·결과·commit SHA, 인증·인가·세션·데이터 영향, secret 부재, migration·rollback, 잔여 위험을 기록하는 checkbox를 작성한다. `docs/guides/testing.md`에는 RED가 assertion 실패여야 하고 실행 환경 오류는 RED 증거가 아니라는 원칙, GREEN 최소 구현, REFACTOR 전체 회귀와 commit SHA 기록을 명시한다.

- [ ] **Step 4: GREEN과 전체 회귀 확인**

Run: `node --test scripts/security/workflow-policy.test.mjs && pnpm test`

Expected: workflow policy tests와 기존 46개 회귀 테스트 전부 PASS.

- [ ] **Step 5: 커밋**

```powershell
git add -- .github/pull_request_template.md scripts/security/workflow-policy.test.mjs docs/guides/testing.md
git commit -m "docs: restore UTF-8 security guidance"
```

---

### Task 2: Strict TypeScript workspace와 재현 가능한 의존성

**Files:**
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Modify: `packages/config/README.md`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `scripts/required-structure.mjs`
- Test: `scripts/workspace-policy.test.mjs`
- Create: `pnpm-lock.yaml` through pnpm.

**Interfaces:**
- Consumes: Node 22.15.1 and pnpm 11.9.0.
- Produces: `pnpm lint`, `pnpm typecheck`, `pnpm test:workspace`, `pnpm build`, `pnpm run verify`.

- [ ] **Step 1: strict compiler와 workspace script 실패 테스트 작성**

```js
test("workspace pins strict TypeScript and verification scripts", () => {
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));

  assert.equal(pkg.devDependencies.typescript, "6.0.3");
  assert.equal(pkg.scripts.verify, "pnpm lint && pnpm typecheck && pnpm test && pnpm build");
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.noUncheckedIndexedAccess, true);
  assert.equal(tsconfig.compilerOptions.exactOptionalPropertyTypes, true);
});
```

- [ ] **Step 2: RED 확인**

Run: `node --test scripts/workspace-policy.test.mjs`

Expected: FAIL because `tsconfig.base.json` does not exist.

- [ ] **Step 3: package와 compiler 기준 작성**

`tsconfig.base.json`의 핵심 compiler option을 다음과 같이 고정한다.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": false
  }
}
```

Root exact dev dependencies는 `typescript@6.0.3`, `vitest@4.1.10`, `@vitest/coverage-v8@4.1.10`, `eslint@10.7.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.64.0`, `globals@17.7.0`, `prettier@3.9.5`, `tsx@4.23.1`, `@types/node@22.20.1`이다. 별도 config package와 Vitest workspace file은 만들지 않고 root compiler/lint 기준을 package별 `tsconfig.json`과 `vitest.config.ts`가 직접 확장한다. `.npmrc`의 `save-exact=true`, `engine-strict=true`, `strict-peer-dependencies=true`를 유지한다.

`pnpm-workspace.yaml`은 `apps/*`, `packages/*`, `tests/*` 세 경계를 포함해 DB와 E2E test package도 같은 lockfile과 exact-version 정책을 사용하게 한다.

Root script는 다음 이름과 조합을 사용한다.

```json
{
  "test:legacy": "node --test scripts/verify-structure.test.mjs scripts/workspace-policy.test.mjs scripts/security/*.test.mjs scripts/security-gate.test.mjs scripts/setup-hooks.test.mjs",
  "test:workspace": "pnpm --filter @account-book/contracts --filter @account-book/database --filter @account-book/web --filter @account-book/api test",
  "test": "pnpm test:legacy && pnpm test:workspace",
  "test:db": "pnpm --filter @account-book/database-tests test",
  "lint": "eslint . --max-warnings=0",
  "typecheck": "pnpm --filter @account-book/contracts --filter @account-book/database --filter @account-book/web --filter @account-book/api --filter @account-book/database-tests --filter @account-book/e2e typecheck",
  "build": "pnpm --filter @account-book/contracts build && pnpm --filter @account-book/database build && pnpm --filter @account-book/api build && pnpm --filter @account-book/web build",
  "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
}
```

- [ ] **Step 4: 설치하고 GREEN 확인**

Run: `pnpm install && node --test scripts/workspace-policy.test.mjs && pnpm lint && pnpm typecheck`

Expected: lockfile 생성, policy test PASS, lint/typecheck exit 0.

- [ ] **Step 5: 커밋**

```powershell
git add -- package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs packages/config/README.md scripts/required-structure.mjs scripts/workspace-policy.test.mjs
git commit -m "build: establish strict TypeScript workspace"
```

---

### Task 3: Framework 독립 인증 계약

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/auth.test.ts`
- Test: `packages/contracts/src/errors.test.ts`

**Interfaces:**
- Consumes: Zod 4.4.3.
- Produces: `AuthProvider`, `SignUpInput`, `SignInInput`, `PasswordResetRequestInput`, `PasswordUpdateInput`, `CurrentUser`, `ApiError`, `parseApiError()`.

- [ ] **Step 1: 계약의 경계값 실패 테스트 작성**

```ts
it("accepts only supported providers and bounded credentials", () => {
  expect(AuthProviderSchema.options).toEqual(["google", "kakao", "naver"]);
  expect(SignInInputSchema.safeParse({ email: "person@example.test", password: "a".repeat(12) }).success).toBe(true);
  expect(SignInInputSchema.safeParse({ email: "bad", password: "short" }).success).toBe(false);
  expect(PasswordUpdateInputSchema.safeParse({ password: "a".repeat(1025) }).success).toBe(false);
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/contracts test`

Expected: FAIL because the schemas are not exported.

- [ ] **Step 3: 최소 schema와 오류 계약 구현**

```ts
export const AuthProviderSchema = z.enum(["google", "kakao", "naver"]);
export const SignInInputSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(1024),
}).strict();
export const CurrentUserSchema = z.object({
  id: z.uuid(),
  email: z.email().nullable(),
  emailVerified: z.boolean(),
}).strict();
export const ApiErrorSchema = z.object({
  code: z.enum([
    "AUTH_INVALID_CREDENTIALS",
    "AUTH_EMAIL_VERIFICATION_REQUIRED",
    "AUTH_SESSION_EXPIRED",
    "AUTH_SESSION_REFRESH_REQUIRED",
    "AUTH_CSRF_REJECTED",
    "AUTH_OAUTH_TRANSACTION_INVALID",
    "AUTH_RATE_LIMITED",
    "AUTH_PROVIDER_UNAVAILABLE",
  ]),
  message: z.string().min(1).max(300),
  requestId: z.string().min(8).max(128),
  retryable: z.boolean(),
  fieldErrors: z.array(z.object({ field: z.string(), code: z.string() })).max(20),
}).strict();
```

가입, reset 요청과 password update schema도 같은 길이 제한과 `.strict()`를 적용하고 inferred type을 export한다. 외부 입력은 항상 schema의 `parse` 또는 `safeParse` 결과만 domain으로 전달한다.

- [ ] **Step 4: GREEN 확인**

Run: `pnpm --filter @account-book/contracts test && pnpm --filter @account-book/contracts typecheck`

Expected: contract tests PASS and typecheck exit 0.

- [ ] **Step 5: 커밋**

```powershell
git add -- packages/contracts package.json pnpm-lock.yaml
git commit -m "feat: define authentication contracts"
```

---

### Task 4: 비공개 인증 schema와 PostgreSQL 권한

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/src/schema/auth.ts`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/index.ts`
- Create: `supabase/migrations/202607200001_security_auth_foundation.sql`
- Test: `tests/database/auth-migration.test.ts`
- Create: `tests/database/package.json`

**Interfaces:**
- Consumes: Drizzle ORM 0.45.2, pg 8.22.0 and `TEST_DATABASE_URL` for DB tests.
- Produces: `authSessions`, `oauthTransactions`, `authRecoveryTransactions`, `authRateLimits`, `createDatabaseClient(connectionString)`.

- [ ] **Step 1: migration 권한과 constraint 실패 테스트 작성**

```ts
it("keeps auth token tables private and selectors unique", async () => {
  const columns = await admin.query(`select column_name from information_schema.columns where table_schema = 'app_private' and table_name = 'auth_sessions'`);
  expect(columns.rows.map((row) => row.column_name)).toContain("selector_hash");
  await expect(publicClient.query("select * from app_private.auth_sessions")).rejects.toThrow(/permission denied/u);
  await expect(insertTwoSessionsWithSameSelector(admin)).rejects.toThrow(/unique/u);
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm test:db`

Expected: FAIL because migration and private tables do not exist. 로컬에 `TEST_DATABASE_URL`이 없으면 이 명령을 실행하지 않고 GitHub PostgreSQL service의 RED 결과를 증거로 사용한다.

- [ ] **Step 3: migration과 Drizzle schema 구현**

Migration은 `app_private` schema, `app_session_bff` NOLOGIN role, 세 테이블과 다음 핵심 제약을 만든다.

```sql
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table app_private.auth_sessions (
  id uuid primary key,
  selector_hash bytea not null unique check (octet_length(selector_hash) = 32),
  user_id uuid not null,
  supabase_session_id uuid not null,
  encrypted_access_token jsonb not null,
  encrypted_refresh_token jsonb not null,
  access_token_expires_at timestamptz not null,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_pending_at timestamptz,
  rotation_version integer not null default 0 check (rotation_version >= 0),
  check (absolute_expires_at > created_at)
);

create unique index auth_sessions_provider_session_unique
  on app_private.auth_sessions (supabase_session_id)
  where revoked_at is null;
```

`oauth_transactions`는 32-byte state hash, 32-byte interaction hash, provider check, encrypted verifier, 상대 return path, expires/consumed 시각을 갖는다. `auth_recovery_transactions`는 32-byte interaction hash, Supabase user ID, 암호화된 제한 recovery token, expires/consumed 시각을 갖는다. `auth_rate_limits`는 32-byte HMAC fingerprint, kind, window, count와 blocked 시각을 갖는다. public·anon·authenticated·service_role의 table 접근을 revoke하고 `app_session_bff`에 필요한 SELECT/INSERT/UPDATE/DELETE만 grant한다.

Database package dependency는 `drizzle-orm@0.45.2`, `pg@8.22.0`, dev dependency는 `@types/pg@8.20.0`을 exact version으로 사용한다. SQL migration을 직접 검토하므로 생성용 `drizzle-kit`은 추가하지 않는다. DB test package는 `pg@8.22.0`, `@types/pg@8.20.0`과 workspace database package만 사용한다.

- [ ] **Step 4: GREEN 확인**

Run: `pnpm --filter @account-book/database typecheck && pnpm test:db`

Expected: schema typecheck PASS; PostgreSQL에서 private 접근 거부, selector uniqueness, provider check와 grant tests PASS.

- [ ] **Step 5: 커밋**

```powershell
git add -- packages/database supabase/migrations/202607200001_security_auth_foundation.sql tests/database package.json pnpm-lock.yaml
git commit -m "feat: add private authentication schema"
```

---

### Task 5: Selector와 versioned AES-GCM token envelope

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/server/security/session-selector.ts`
- Create: `apps/web/src/server/security/token-envelope.ts`
- Test: `apps/web/src/server/security/session-selector.test.ts`
- Test: `apps/web/src/server/security/token-envelope.test.ts`

**Interfaces:**
- Produces: `createSessionSelector(): string`, `hashSessionSelector(selector: string): Uint8Array`, `TokenKeyring`, `encryptToken(plaintext, context, keyring): TokenEnvelope`, `decryptToken(envelope, context, keyring): string`.

- [ ] **Step 1: randomness·tamper·AAD 실패 테스트 작성**

```ts
it("creates a 256-bit selector and stores only its digest", () => {
  const selector = createSessionSelector();
  expect(Buffer.from(selector, "base64url")).toHaveLength(32);
  expect(hashSessionSelector(selector)).toHaveLength(32);
});

it("rejects ciphertext copied to another session context", () => {
  const envelope = encryptToken("server-token", { recordId: "s1", tokenKind: "refresh" }, keyring);
  expect(() => decryptToken(envelope, { recordId: "s2", tokenKind: "refresh" }, keyring)).toThrow(TokenEnvelopeError);
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/web test -- src/server/security/token-envelope.test.ts`

Expected: FAIL because encryption exports do not exist.

- [ ] **Step 3: 최소 암호화 구현**

```ts
export type TokenContext = { recordId: string; tokenKind: "access" | "refresh" | "pkce" | "recovery" };
export type TokenEnvelope = { version: 1; keyId: string; iv: string; ciphertext: string; tag: string };
export type TokenKeyring = { currentKeyId: string; keys: ReadonlyMap<string, Uint8Array> };
```

`randomBytes(32)`, `createHash("sha256")`, `createCipheriv("aes-256-gcm", key, randomBytes(12))`를 사용한다. AAD는 canonical JSON이 아니라 고정 순서 `v1\0recordId\0tokenKind` UTF-8 bytes로 만든다. `recordId`는 session, OAuth 또는 recovery transaction의 내부 UUID다. key 길이, selector encoding, envelope field와 plaintext 빈 값을 검증하고 어떤 실패도 token 내용을 포함하지 않는 `TokenEnvelopeError("TOKEN_ENVELOPE_INVALID")`로 변환한다.

`apps/web/package.json`은 `@account-book/contracts`와 `@account-book/database`를 `workspace:*`로 연결하고 `test`, `test:coverage`, `typecheck` script를 제공한다. Next.js runtime dependency는 BFF task에서 추가한다.

- [ ] **Step 4: GREEN·REFACTOR 확인**

Run: `pnpm --filter @account-book/web test -- src/server/security && pnpm --filter @account-book/web typecheck`

Expected: selector/envelope tests PASS, typecheck exit 0, security module branch coverage 100%.

- [ ] **Step 5: 커밋**

```powershell
git add -- apps/web/src/server/security apps/web/package.json pnpm-lock.yaml
git commit -m "feat: protect server-side auth tokens"
```

---

### Task 6: Cookie, CSRF, Origin과 Fetch Metadata 방어

**Files:**
- Create: `apps/web/src/server/security/auth-cookie.ts`
- Create: `apps/web/src/server/security/csrf.ts`
- Create: `apps/web/src/server/security/request-origin.ts`
- Test: matching `*.test.ts` files.

**Interfaces:**
- Produces: `sessionCookie(value, secure)`, `interactionCookie(value, secure)`, `clearAuthCookie(name, secure)`, `issueCsrfToken(context, now, key)`, `verifyCsrfRequest(request, context, policy)`.

- [ ] **Step 1: cookie와 request allow/deny matrix 실패 테스트 작성**

```ts
it("builds a host-only HttpOnly session cookie", () => {
  expect(sessionCookie("opaque", true)).toEqual({
    name: "__Host-ab_session", value: "opaque", httpOnly: true,
    secure: true, sameSite: "lax", path: "/", priority: "high",
  });
});

it.each([
  ["missing origin", requestWithoutOrigin()],
  ["cross site", requestFrom("https://attacker.invalid", "cross-site")],
  ["bad token", sameOriginRequest("tampered")],
])("rejects %s", (_name, request) => {
  expect(() => verifyCsrfRequest(request, context, policy)).toThrow(AuthRequestRejectedError);
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/web test -- src/server/security/auth-cookie.test.ts src/server/security/csrf.test.ts src/server/security/request-origin.test.ts`

Expected: FAIL because cookie and CSRF functions are absent.

- [ ] **Step 3: 최소 구현**

CSRF token은 `v1.expiry.nonce.signature` 구조로 만들고 signature는 session/interaction selector와 token 앞부분에 대한 HMAC-SHA-256이다. `timingSafeEqual` 전 길이를 확인한다. 허용 origin은 `URL.origin`의 정확한 Set으로 비교하고 `Sec-Fetch-Site`는 `same-origin` 또는 `none`만 허용한다. Origin이 없는 경우에만 same-origin Referer fallback을 사용한다.

- [ ] **Step 4: GREEN 확인**

Run: `pnpm --filter @account-book/web test -- src/server/security && pnpm --filter @account-book/web typecheck`

Expected: cookie·CSRF·origin tests PASS and security branch coverage 100%.

- [ ] **Step 5: 커밋**

```powershell
git add -- apps/web/src/server/security
git commit -m "feat: enforce auth request boundary"
```

---

### Task 7: 불투명 세션 domain과 PostgreSQL adapter

**Files:**
- Create: `apps/web/src/server/persistence/auth-repository.ts`
- Create: `apps/web/src/server/persistence/postgres-auth-repository.ts`
- Create: `apps/web/src/server/session/session-service.ts`
- Test: matching `*.test.ts` files.

**Interfaces:**
- Consumes: selector/hash, token envelope and Drizzle schema.
- Produces: `SessionService.create`, `resolve`, `refresh`, `revokeCurrent`, `revokeAllForUser`, `markRevocationPending`.

- [ ] **Step 1: plaintext 부재·만료·동시 rotation 실패 테스트 작성**

```ts
it("stores only a selector digest and encrypted tokens", async () => {
  const result = await service.create(tokens, now);
  const stored = repository.onlyRecord();
  expect(stored.selectorHash).toEqual(hashSessionSelector(result.selector));
  expect(JSON.stringify(stored)).not.toContain(tokens.refreshToken);
});

it("allows exactly one compare-and-swap refresh", async () => {
  const [first, second] = await Promise.all([service.refresh(selector, now), service.refresh(selector, now)]);
  expect([first.status, second.status].sort()).toEqual(["refreshed", "superseded"]);
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/web test -- src/server/session`

Expected: FAIL because `SessionService` is undefined.

- [ ] **Step 3: repository port와 service 구현**

```ts
export interface AuthRepository {
  create(input: NewSessionRecord): Promise<void>;
  findActiveBySelectorHash(hash: Uint8Array, now: Date): Promise<AuthSessionRecord | null>;
  rotate(input: RotateSessionInput): Promise<boolean>;
  revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean>;
  revokeAllForUser(userId: string, now: Date): Promise<number>;
  markRevocationPending(sessionId: string, now: Date): Promise<void>;
}
```

별도 memory production class는 만들지 않는다. `session-service.test.ts`의 작은 object stub이 같은 interface를 만족한다. PostgreSQL adapter 하나가 이후 OAuth·recovery·rate-limit method도 함께 구현해 pool과 transaction 처리 코드를 중복하지 않는다.

`resolve`은 revoked, 7일 idle과 30일 absolute expiry를 fail closed로 거부한다. `refresh`는 기존 rotation version과 Supabase session ID를 compare-and-swap 조건으로 사용하고 새 token pair 전체를 한 transaction에서 교체한다. `GET /session` 경로의 resolve는 `last_seen_at`을 갱신하지 않는다.

- [ ] **Step 4: GREEN과 DB adapter 검증**

Run: `pnpm --filter @account-book/web test -- src/server/session src/server/persistence && pnpm --filter @account-book/web typecheck`

Expected: memory service tests와 PostgreSQL query contract tests PASS.

- [ ] **Step 5: 커밋**

```powershell
git add -- apps/web/src/server/persistence apps/web/src/server/session
git commit -m "feat: manage opaque authentication sessions"
```

---

### Task 8: Supabase Auth port와 이메일 인증 use case

**Files:**
- Create: `apps/web/src/server/auth/auth-provider-port.ts`
- Create: `apps/web/src/server/auth/supabase-auth-adapter.ts`
- Create: `apps/web/src/server/auth/email-auth-service.ts`
- Create: `apps/web/src/server/auth/fake-auth-provider.ts`
- Test: matching `*.test.ts` files.

**Interfaces:**
- Produces: `AuthProviderPort`, `AuthTokenPair`, `EmailAuthService.signUp`, `signIn`, `confirmEmail`, `requestPasswordReset`.

- [ ] **Step 1: email 미확인·계정 열거·token 비노출 실패 테스트 작성**

```ts
it("does not create an app session before email verification", async () => {
  fakeAuth.signInResult = { kind: "email_unverified" };
  await expect(service.signIn(validInput, context)).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
  expect(sessionRepository.records).toHaveLength(0);
});

it("returns the same reset response for present and absent accounts", async () => {
  expect(await service.requestPasswordReset("present@example.test", context))
    .toEqual(await service.requestPasswordReset("absent@example.test", context));
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/web test -- src/server/auth/email-auth-service.test.ts`

Expected: FAIL because the auth port and service do not exist.

- [ ] **Step 3: port, safe error mapping과 server-only Supabase adapter 구현**

```ts
export interface AuthProviderPort {
  signUp(input: SignUpInput, redirectUrl: URL): Promise<EmailAuthResult>;
  signInWithPassword(input: SignInInput): Promise<AuthTokenPair>;
  confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair>;
  startOAuth(input: OAuthStartInput): Promise<OAuthStartResult>;
  exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair>;
  refresh(refreshToken: string): Promise<AuthTokenPair>;
  signOut(accessToken: string, refreshToken: string): Promise<void>;
  requestPasswordReset(email: string, redirectUrl: URL): Promise<void>;
  exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext>;
  updatePassword(input: PasswordUpdateAtProviderInput): Promise<void>;
}
```

같은 파일에서 `EmailConfirmationInput`, `OAuthStartInput`, `OAuthExchangeInput`, `RecoveryExchangeInput`, `PasswordUpdateAtProviderInput`, `AuthTokenPair`, `EmailAuthResult`, `OAuthStartResult`, `RecoveryContext`를 readonly object type으로 정의하고 token-bearing type은 server-only module 밖으로 export하지 않는다.

Supabase client는 server-only 파일에서 요청별로 생성하고 `autoRefreshToken:false`, `persistSession:false`, `detectSessionInUrl:false`, `flowType:"pkce"`를 사용한다. 외부 오류 mapping은 adapter 안의 작은 allowlist 함수로 두고 별도 오류 module을 만들지 않으며 원문 message를 response/log에 전달하지 않는다.

이 task에서 `apps/web/package.json`에 `@supabase/supabase-js@2.110.7`, `server-only@0.0.1`을 exact dependency로 추가하고 lockfile을 갱신한다.

- [ ] **Step 4: GREEN 확인**

Run: `pnpm --filter @account-book/web test -- src/server/auth src/server/persistence && pnpm --filter @account-book/web typecheck`

Expected: email auth tests PASS; response serialization에 token 문자열 0건.

- [ ] **Step 5: 커밋**

```powershell
git add -- apps/web/src/server/auth apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add server-only email authentication"
```

---

### Task 9: OAuth 거래와 비밀번호 recovery 상태기계

**Files:**
- Modify: `apps/web/src/server/persistence/auth-repository.ts`
- Modify: `apps/web/src/server/persistence/postgres-auth-repository.ts`
- Create: `apps/web/src/server/auth/oauth-service.ts`
- Create: `apps/web/src/server/auth/password-recovery-service.ts`
- Test: matching `*.test.ts` files.

**Interfaces:**
- Produces: `OAuthService.start(provider, context)`, `OAuthService.complete(callback, context)`, `PasswordRecoveryService.exchange`, `PasswordRecoveryService.update`.

- [ ] **Step 1: provider allowlist·state replay·binding 실패 테스트 작성**

```ts
it.each(["expired", "consumed", "wrong-provider", "wrong-browser"] as const)(
  "rejects an %s OAuth transaction",
  async (variant) => expect(completeVariant(variant)).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" }),
);

it("maps Naver only to the approved custom provider", () => {
  expect(providerId("naver")).toBe("custom:naver");
  expect(providerId("google")).toBe("google");
  expect(providerId("kakao")).toBe("kakao");
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/web test -- src/server/auth/oauth-service.test.ts src/server/auth/password-recovery-service.test.ts`

Expected: FAIL because OAuth/recovery state machines are absent.

- [ ] **Step 3: 단일 소비 transaction 구현**

OAuth start는 state와 PKCE verifier를 생성하고 state·interaction selector는 hash로, verifier는 `tokenKind:"pkce"` AAD로 암호화해 10분 만료 거래에 저장한다. callback은 provider, state, interaction hash와 만료를 확인하고 DB update `consumed_at is null` 조건으로 먼저 소비권을 획득한 한 요청만 code를 교환한다. 허용 return path는 `/app`과 `/settings/security` 두 상대 경로뿐이다.

Recovery context는 기존 `__Host-ab_interaction` HttpOnly cookie에 바인딩된 15분 만료 `auth_recovery_transactions` record를 사용한다. 별도 recovery cookie를 추가하지 않으며 password update 성공 후 거래를 소비하고 사용자의 모든 app session을 폐기한다.

- [ ] **Step 4: GREEN 확인**

Run: `pnpm --filter @account-book/web test -- src/server/auth && pnpm --filter @account-book/web typecheck`

Expected: OAuth/recovery tests PASS, state와 code가 오류·로그 snapshot에 없음.

- [ ] **Step 5: 커밋**

```powershell
git add -- apps/web/src/server/auth apps/web/src/server/persistence
git commit -m "feat: secure OAuth and password recovery"
```

---

### Task 10: Next.js BFF route와 ky·TanStack Query 경계

**Files:**
- Modify: `apps/web/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/server/container.ts`
- Create: `apps/web/src/server/http/auth-controller.ts`
- Create: `apps/web/src/app/api/auth/**/route.ts`
- Create: `apps/web/src/app/api/me/route.ts`
- Create: `apps/web/src/lib/http/api-client.ts`
- Create: `apps/web/src/lib/http/csrf-client.ts`
- Create: `apps/web/src/queries/auth.ts`
- Create: `apps/web/src/app/providers.tsx`
- Test: controller, route adapter and client tests.

**Interfaces:**
- Consumes: contracts, security, session and auth services.
- Produces: BFF HTTP routes, `apiClient`, `getCurrentUser`, `useCurrentUser`, auth mutations.

- [ ] **Step 1: route 응답·cookie·cache 실패 테스트 작성**

```ts
it("returns an opaque cookie and never serializes provider tokens", async () => {
  const response = await controller.signIn(validRequest());
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("__Host-ab_session=");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).not.toMatch(/access-token|refresh-token/u);
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/web test -- src/server/http src/lib/http src/queries`

Expected: FAIL because BFF controller and client functions are absent.

- [ ] **Step 3: 얇은 route adapter와 client 구현**

Route Handler는 request를 controller에 전달하고 controller가 schema, request boundary와 use case를 호출하게 한다. `container.ts`는 요청마다 dependency graph를 만들며 사용자별 Supabase client나 session을 module scope에 cache하지 않는다. `/api/me`만 고정된 `API_INTERNAL_URL/v1/me`로 전달하고 사용자 제공 URL이나 hop-by-hop header를 전달하지 않는다.

`AUTH_ADAPTER_MODE=fake`는 `NODE_ENV=production`이 아니고 application origin hostname이 `localhost`, `127.0.0.1` 또는 `[::1]`일 때만 허용한다. 조건을 하나라도 만족하지 않으면 startup을 중단하는 environment test를 작성한다. 운영 기본값과 build-time 기본값은 항상 `supabase`다.

이 task에서 `next@16.2.10`, `react@19.2.7`, `react-dom@19.2.7`, `ky@2.0.2`, `@tanstack/react-query@5.101.2`, `zod@4.4.3`과 대응 type package `@types/react@19.2.17`, `@types/react-dom@19.2.3`을 exact version으로 추가한다.

```ts
export const apiClient = ky.create({
  prefixUrl: "/api",
  credentials: "same-origin",
  retry: { limit: 0 },
  timeout: 10_000,
  headers: { accept: "application/json" },
});
```

인증 복구는 `AUTH_SESSION_REFRESH_REQUIRED`에만 CSRF token을 얻어 refresh POST 한 번과 원 요청 재시도 한 번을 수행한다. 401·403·422와 mutation은 일반 자동 재시도를 하지 않는다.

- [ ] **Step 4: GREEN·build 확인**

Run: `pnpm --filter @account-book/web test && pnpm --filter @account-book/web typecheck && pnpm --filter @account-book/web build`

Expected: BFF/client tests PASS, strict typecheck and Next production build exit 0.

- [ ] **Step 5: 커밋**

```powershell
git add -- apps/web package.json pnpm-lock.yaml
git commit -m "feat: expose same-origin authentication BFF"
```

---

### Task 11: Impeccable 기반 반응형 인증 UI와 필수 motion

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/(auth)/layout.tsx`
- Create: login, sign-up, verify-email, forgot-password, reset-password pages.
- Create: `apps/web/src/components/auth/auth-shell.tsx`, `auth-form.tsx`, `provider-buttons.tsx`, `auth-status.tsx`
- Test: component tests for keyboard, labels, loading, error and reduced motion.

**Interfaces:**
- Consumes: auth mutations and approved `DESIGN.md`.
- Produces: PC/mobile compatible authentication experience with no client token state.

- [ ] **Step 1: Impeccable skill을 읽고 UI acceptance test 작성**

구현 작업을 시작하기 직전에 repository의 `impeccable` skill을 사용한다. 다음 test를 먼저 작성한다.

```tsx
it("keeps the form accessible while a sign-in is pending", async () => {
  render(<SignInForm submit={pendingSubmit} />);
  expect(screen.getByLabelText("이메일")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByLabelText("비밀번호")).toHaveAttribute("autocomplete", "current-password");
  await user.click(screen.getByRole("button", { name: "로그인" }));
  expect(screen.getByRole("button", { name: "로그인 중" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("안전하게 로그인하고 있어요");
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/web test -- src/components/auth`

Expected: FAIL because the auth components do not exist.

- [ ] **Step 3: 반응형 UI와 motion 구현**

배경 `oklch(0.985 0.004 260)`, ink `oklch(0.22 0.02 260)`, accent `oklch(0.52 0.18 270)`을 시작 token으로 사용하고 실제 contrast test를 통과할 때만 유지한다. desktop은 설명 panel과 form의 2열, 768px 이하는 단일열이다. radius는 16px 이하, shadow는 focus된 floating surface에만 사용한다. 숫자에는 `font-variant-numeric: tabular-nums`를 적용한다.

Component test dependency는 `@testing-library/react@16.3.2`, `@testing-library/user-event@14.6.1`, `jsdom@29.1.1`을 exact version으로 추가한다. Vitest의 내장 JSX transform을 사용해 Vite React plugin과 직접 Vite dependency는 추가하지 않는다.

loading spinner와 상태 전환은 180ms ease-out으로 제한하고 다음 media query로 축소한다.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
```

Google·Kakao·Naver button은 provider label을 텍스트로 제공하며 색상이나 logo만으로 구분하지 않는다. 오류는 field error와 form-level status에 연결하고 token/provider 원문을 표시하지 않는다.

- [ ] **Step 4: GREEN·접근성·반응형 확인**

Run: `pnpm --filter @account-book/web test -- src/components/auth && pnpm --filter @account-book/web build`

Expected: keyboard/label/loading/error/reduced-motion tests PASS and build exit 0. Playwright에서 390x844와 1440x900 viewport의 overflow 0건.

- [ ] **Step 5: 커밋**

```powershell
git add -- apps/web/package.json apps/web/src/app apps/web/src/components/auth pnpm-lock.yaml
git commit -m "feat: build responsive authentication UI"
```

---

### Task 12: NestJS/Fastify JWT 검증과 `/v1/me`

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `apps/api/src/main.ts`, `app.module.ts`
- Create: `apps/api/src/environment.ts`
- Create: `apps/api/src/auth/jwt-verifier.ts`, `auth.guard.ts`, `principal.ts`
- Create: `apps/api/src/me/me.controller.ts`, `me.module.ts`
- Create: `apps/api/src/common/api-error.filter.ts`, `request-context.ts`
- Test: verifier, guard, error and endpoint tests.

**Interfaces:**
- Consumes: jose 6.2.3 and shared `CurrentUser`/`ApiError` contracts.
- Produces: `/health`, protected `/v1/me`, `AuthPrincipal { userId, sessionId }`.

- [ ] **Step 1: JWT 변조와 claim matrix 실패 테스트 작성**

```ts
it.each([
  ["wrong issuer", token({ issuer: "https://wrong.invalid" })],
  ["wrong audience", token({ audience: "other" })],
  ["expired", token({ expiresInSeconds: -1 })],
  ["missing session", token({ sessionId: undefined })],
])("rejects %s", async (_name, jwt) => {
  await expect(verifier.verify(jwt)).rejects.toThrow(InvalidAccessTokenError);
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/api test -- src/auth`

Expected: FAIL because verifier and guard are absent.

- [ ] **Step 3: verifier, guard와 safe logging 구현**

```ts
export type AuthPrincipal = Readonly<{ userId: string; sessionId: string }>;

export interface AccessTokenVerifier {
  verify(token: string): Promise<AuthPrincipal>;
}
```

`createRemoteJWKSet`과 `jwtVerify`에 exact issuer, audience와 `algorithms:[configuredAlgorithm]`을 전달한다. Bearer header는 하나만 허용하고 길이를 제한한다. `sub`와 `session_id` UUID를 검증한 뒤 principal을 request scope에 설정한다. request context는 safe request ID만 기록하고 request header/body 전체를 로깅하지 않는다. Fastify helmet을 등록하고 browser CORS를 활성화하지 않는다. 환경 변수는 shared Zod schema로 한 번 파싱하고 별도 config framework를 추가하지 않는다.

API exact dependency는 `@nestjs/core@11.1.28`, `@nestjs/common@11.1.28`, `@nestjs/platform-fastify@11.1.28`, `fastify@5.10.0`, `@fastify/helmet@13.1.0`, `jose@6.2.3`, `reflect-metadata@0.2.2`, `rxjs@7.8.2`다. Test dependency는 `@nestjs/testing@11.1.28`만 추가하고 HTTP test는 Fastify의 내장 `inject()`를 사용한다. 별도 config, logger와 Supertest dependency는 추가하지 않는다.

- [ ] **Step 4: GREEN·API build 확인**

Run: `pnpm --filter @account-book/api test && pnpm --filter @account-book/api typecheck && pnpm --filter @account-book/api build`

Expected: JWT/error/endpoint tests PASS, `/v1/me` unauthenticated 401 and valid token 200, build exit 0.

- [ ] **Step 5: 커밋**

```powershell
git add -- apps/api package.json pnpm-lock.yaml
git commit -m "feat: verify API authentication principals"
```

---

### Task 13: 전체 통합, CI, 보안 문서와 hosted smoke 절차

**Files:**
- Create: `tests/e2e/package.json`, `tests/e2e/playwright.config.ts`, `tests/e2e/test-idp-server.ts`, `tests/e2e/auth.spec.ts`
- Create: `tests/e2e/production-fake-startup.test.ts`, `tests/database/prepare-auth-e2e.ts`, `tests/database/prepare-auth-e2e.test.ts`, `apps/web/scripts/assert-auth-startup.mjs`
- Modify: `tests/database/package.json`, `tests/database/tsconfig.json`, `apps/web/package.json`, `apps/web/next.config.ts`
- Modify: `.github/workflows/security-gate.yml`
- Modify: `scripts/security/workflow-policy.test.mjs`
- Modify: `README.md`, `apps/web/README.md`, `apps/api/README.md`
- Create: `docs/architecture/adr/0001-opaque-auth-sessions.md`
- Create: `docs/guides/auth-environment.md`
- Create: `docs/guides/security-auth-testing.md`
- Modify: `docs/security/security-architecture.md`, `docs/security/verification-checklist.md`

**Interfaces:**
- Consumes: 전체 auth vertical slice.
- Produces: 재현 가능한 CI gate, E2E 증거, 운영 전 OAuth checklist와 최종 진행 기록.

- [ ] **Step 1: E2E와 CI policy 실패 테스트 작성**

```ts
test("email login never exposes provider tokens", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("verified@example.test");
  await page.getByLabel("비밀번호").fill("correct-horse-battery");
  const responsePromise = page.waitForResponse("**/api/auth/sign-in");
  await page.getByRole("button", { name: "로그인" }).click();
  const response = await responsePromise;
  expect(await response.text()).not.toMatch(/access_token|refresh_token/u);
  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)];
    })),
    session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) ?? "";
      return [key, sessionStorage.getItem(key)];
    })),
  }));
  expect(JSON.stringify(storage)).not.toMatch(/token|session/u);
});
```

Workflow policy test에는 frozen install, `pnpm run verify`, PostgreSQL service, `pnpm test:db`, 읽기 전용 permission, SHA-pinned action 두 개만 허용하는 assertion을 추가한다.

E2E package는 `@playwright/test@1.61.1`과 `@axe-core/playwright@4.12.1`을 exact dev dependency로 사용한다. `test-idp-server.ts`는 test 전용 ES256 key pair로 JWT와 JWKS를 제공하며 `127.0.0.1`에만 bind한다. Playwright webServer는 이 IDP, 실제 jose verifier를 사용하는 API, fake Auth adapter를 사용하는 web process를 명시적 port에서 실행하고 기존 server 재사용을 CI에서 금지한다. production mode에서 fake adapter가 선택되면 E2E가 startup 실패를 확인한다.

- [ ] **Step 2: RED 확인**

Run: `pnpm --filter @account-book/e2e test && node --test scripts/security/workflow-policy.test.mjs`

Expected: E2E harness 또는 CI step 누락으로 FAIL.

- [ ] **Step 3: CI와 문서 구현**

Workflow에 digest-pinned `postgres:17@sha256:cb875afe6d2e8593c28c22d37d0fd7aaf035c43a42e2f7792cd4c09ceb6beac5` linux/amd64 service와 health check를 추가하고 checkout/setup-node 뒤 다음 순서를 사용한다.

```yaml
      - name: Enable the pinned package manager
        run: corepack enable
      - name: Install the reviewed dependency graph
        run: pnpm install --frozen-lockfile
      - name: Run repository verification
        run: pnpm run verify
      - name: Verify PostgreSQL authentication boundaries
        env:
          TEST_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/account_book_test
          TEST_DATABASE_DISPOSABLE: 'true'
        run: pnpm test:db
      - name: Prepare the disposable database for browser authentication
        env:
          TEST_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/account_book_test
          TEST_DATABASE_DISPOSABLE: 'true'
        run: pnpm --filter @account-book/database-tests prepare:e2e
      - name: Install the pinned Chromium runtime
        run: pnpm --filter @account-book/e2e exec playwright install --with-deps chromium
      - name: Run browser authentication tests
        env:
          DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/account_book_test
          TEST_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/account_book_test
          TEST_DATABASE_DISPOSABLE: 'true'
        run: pnpm --filter @account-book/e2e test
      - name: Audit production dependencies
        run: pnpm audit --prod --audit-level high
```

기존 security gate range scan은 마지막에 유지한다. workflow 전체를 검토한 뒤 `canonicalWorkflowDigest` 명령으로 새 SHA-256을 계산해 test 상수에 기록한다. action reference, permission, secret reference와 concurrency 정책은 기존 제한을 유지한다.

ADR은 opaque PostgreSQL session 채택 이유, 무상태 cookie와 표준 SSR cookie 비채택 이유, key rotation, 7일 idle·30일 absolute policy와 잔여 위험을 기록한다. 환경 guide는 server-only 변수의 길이·인코딩, 생성 명령, 로컬/CI/hosted 경계, 공급자 callback URL과 secret 입력 위치를 기록한다. 테스트 guide는 각 task의 RED·GREEN 명령, exit code, test 수와 commit SHA를 표로 기록한다.

- [ ] **Step 4: 전체 검증**

Run:

```powershell
pnpm setup:hooks
pnpm run verify
pnpm test:db
pnpm --filter @account-book/database-tests prepare:e2e
pnpm --filter @account-book/e2e exec playwright install --with-deps chromium
pnpm --filter @account-book/e2e test
pnpm audit --prod --audit-level high
git diff --check
git status --short --branch
```

Expected: 모든 test/typecheck/lint/build/E2E/DB 권한 검증 exit 0, high·critical dependency finding 0, diff check 0. `pnpm test:db`는 로컬 PostgreSQL이 없으면 CI의 같은 commit SHA 결과로 대체하고 그 사실을 증거 문서에 명시한다.

- [ ] **Step 5: 개발용 Supabase OAuth smoke checklist 실행 또는 미실행 blocker 기록**

Google, Kakao, `custom:naver` 각각 정상 로그인, 사용자 취소, 잘못된 state, 재사용 callback, email 누락을 확인한다. browser history, Network response, Application storage와 server log에서 token·code·email 원문이 없는지 확인한다. 자격 증명이 준비되지 않았다면 각 항목을 `미실행—운영 출시 차단`으로 기록하고 성공 처리하지 않는다.

- [ ] **Step 6: 최종 커밋**

```powershell
git add -- tests/e2e .github/workflows/security-gate.yml scripts/security/workflow-policy.test.mjs README.md apps/web/README.md apps/api/README.md docs/architecture docs/guides docs/security package.json pnpm-lock.yaml
git commit -m "test: verify authentication foundation end to end"
```

## Plan Self-Review Record

- Spec coverage: 하이브리드 환경, PostgreSQL 불투명 session, browser token 비노출, 이메일·Google·Kakao·Naver, CSRF·Origin·PKCE, JWT 재검증, UI motion, 오류, 문서와 live smoke blocker가 Task 3~13에 매핑된다.
- Scope: 거래·예산·offline, provider 연결·해제, 자동 병합과 관리자 페이지는 구현 파일과 acceptance criteria에서 제외했다.
- Type consistency: `AuthTokenPair`, `AuthRepository`, `AuthProviderPort`, `AuthPrincipal`, `ApiError` 이름은 producer task 이후 consumer task에서 동일하다.
- Security consistency: callback GET 예외는 단일 소비·binding 검증으로 제한하고 일반 상태 변경과 refresh는 POST로 유지한다.
- Environment consistency: Node 22.15.1과 pnpm 11.9.0을 고정하고 Docker가 없는 local 환경의 DB 검증은 동일 SHA의 GitHub PostgreSQL service 결과로만 대체한다.
- Documentation consistency: 보안 판단 주석, 환경 변수, ADR, RED/GREEN/REFACTOR와 실제 OAuth 미실행 blocker를 명시했다.
