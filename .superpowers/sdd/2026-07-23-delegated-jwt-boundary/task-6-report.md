# Task 6 implementation report — delegated API request scope

## RED

Command (after restoring this worktree's dependencies):

```powershell
pnpm --filter @account-book/api test -- auth.guard.test.ts
```

Result: failed as expected. The new guard test expected a request-bound verifier input
(`token`, exact GET descriptor, canonical inbound request ID, and `me:read`), but the
previous guard invoked the verifier with the legacy raw string `"aaa.bbb.ccc"`.

The very first attempt was blocked before Vitest could run because the isolated worktree
had no usable dependency links and pnpm tried to fetch the registry. After the approved
dependency operation completed, the command above produced the expected behavioral RED
failure. It also exposed the obsolete pre-Task-6 controller test, which was replaced with
the delegated-token integration suite.

## GREEN and refactor

- Added `RequireDelegatedScope("me:read")` route metadata and fail-closed reflector lookup.
- Auth guard validates raw, case-insensitive header cardinality, canonical request ID, GET-only
  framing, and creates the verifier descriptor from the raw origin-form URL.
- The verified principal is attached only after request binding and replay consumption succeed.
- Response/error correlation uses only a verified principal RID or a server-generated Fastify ID.
- Replaced remote-JWKS compatibility wiring with one bounded `pg.Pool`, one replay store, and one
  static-key delegated verifier. The replay-store lifecycle owns exactly-once pool closure.
- Removed the Task 5 remote-JWKS compile bridge and corrected the verifier's absent-content-type
  normalization so a valid GET descriptor can be bound.
- Added a real HTTP signed-token/replay test, binding mutation tests, raw-boundary tests, request
  context tests, error mapping tests, and pool/lifecycle wiring coverage.

## Fresh verification gate

```powershell
pnpm --filter @account-book/api test
```

Passed: 7 files, 107 tests.

```powershell
pnpm --filter @account-book/api lint
```

The API package has no `lint` script, so pnpm correctly exited with
`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. The repository-equivalent lint gate was run instead:

```powershell
pnpm -w lint
```

Passed: `eslint . --max-warnings=0`.

```powershell
pnpm --filter @account-book/api typecheck
pnpm --filter @account-book/api build
```

Both passed.

```powershell
rg -n 'createRemoteJWKSet|AUTH_JWKS_URL|session_id|Supabase JWKS' apps/api/src
```

Passed expected negative scan: no output and exit code 1.

```powershell
git diff --check
```

Passed with no whitespace errors.

## Residual risk

No live PostgreSQL success is claimed here. The pool/replay wiring is unit and module tested
without a real database; Task 4's disposable-PostgreSQL evidence remains a release blocker.
The local runtime also reports a Node 24 vs requested Node 22.15.1 engine warning, although all
recorded API test, lint-equivalent, typecheck, and build commands passed.

## Spec-review follow-up

### RED

```powershell
pnpm --filter @account-book/api lint
```

Failed as expected with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`: the API package did not expose a
`lint` script. This was the concrete missing behavior identified by review.

### GREEN

- Added the API `lint` script, delegating to the repository's canonical lint gate.
- Each HTTP request-binding mutation test now retries the same token in its original, correct
  form and proves the rejected mutated request did not consume replay state.
- Replaced the fabricated browser token with a signed Supabase-shaped HS256 JWT carrying its
  standard issuer, `authenticated` audience, `session_id`, subject, and role claims.
- Added an HTTP kill-switch test that asserts only the fixed detail-free 503 envelope.
- Added raw coalesced request-ID and duplicated/coalesced content-length guard cases, plus a
  Fastify-adapter request-ID test proving inbound header data cannot become `request.id`.

```powershell
pnpm --filter @account-book/api lint
pnpm --filter @account-book/api test
```

Passed: canonical workspace lint and 112 API tests.

The complete final gate was then rerun: API test, exact filtered lint, typecheck, build, and
`git diff --check` passed. The legacy scan again returned the expected exit 1 with no matches;
the Supabase fixture retains a real `session_id` runtime claim without reintroducing that retired
legacy identifier as a source literal.

## Final correlation review follow-up

### RED

An integration-style filter/onSend regression used malformed internal request-ID candidates.
It failed with two distinct generated UUIDs: the filter body contained one fallback ID while the
later `onSend` hook overwrote the response header with another.

### GREEN

Response correlation now selects one safe ID and memoizes it on a private request symbol. The
error filter and `onSend` hook share this value, while selection still accepts only a canonical
verified principal ID or canonical local Fastify ID; it never reads or reflects inbound headers.

```powershell
pnpm --filter @account-book/api test -- api-error.filter.test.ts
pnpm --filter @account-book/api lint
```

Passed: 113 API tests and the exact filtered lint command.
