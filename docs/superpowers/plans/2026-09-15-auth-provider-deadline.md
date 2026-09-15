# 인증 제공자 작업당 5초 제한 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase SDK를 유지하면서 인증 제공자 작업 하나의 전송·본문 읽기·순차 호출·응답 검증에 총 5,000ms 제한을 적용한다.

**Architecture:** 작업마다 독립적인 시간 제한 객체를 만들고 직접 HTTP와 SDK에 같은 안전한 fetch를 전달한다. 시간 관리와 전송 처리를 별도 모듈로 분리하고 어댑터는 입력 검증·작업 순서·결과 검증만 조정한다. 원시 전송 오류는 SDK에 도달하기 전에 차단한다.

**Tech Stack:** Node.js 22.15.1, pnpm 11.9.0, TypeScript, 기존 Supabase SDK, Fetch/AbortController, Vitest 4.1.11.

**Spec:** [승인된 A안·총 5초 설계](../specs/2026-09-14-auth-provider-deadline-design.md)

## Global Constraints

- 기준 브랜치 `feature/auth-provider-deadline`, 기준 커밋 `bb537e5d8024ca82b8bf5a8faba23472b31be274`.
- SDK 유지 A안, **작업당 총 5,000ms**. 새 의존성·프레임워크·DB·UI·자동 재시도는 추가하지 않는다.
- `startOAuth`는 URL 생성만 하므로 타이머를 만들지 않는다. 사용자 OAuth 동의·메일 확인 대기 시간은 이 제한에 포함하지 않는다.
- 로컬 입력 검증 후 외부 작업 전에 예산을 시작한다. 응답 본문 읽기와 검증도 포함한다. 순차 SDK 호출마다 예산을 재설정하지 않는다.
- 단조 증가 시계로 경과 시간을 확인한다. `>= 5,000ms`에서는 성공할 수 없다. 이벤트 루프가 멈춘 동안까지 정확히 5초를 보장하는 실시간 시스템은 아니다.
- 실제 fetch에 abort 신호를 전달한다. `Promise.race`만 추가하고 전송을 방치하는 구현은 허용하지 않는다.
- 시간 초과·취소·전송 실패는 `AUTH_PROVIDER_UNAVAILABLE`. 원시 오류·URL·헤더·토큰·비밀번호·제공자 본문을 로그나 공개 응답에 넣지 않는다.
- 429, 이메일 미확인, 자격 증명 오류, PKCE 오류, 계정 열거 방지 정책은 유지한다. 전역 console 교체·SDK 파일 직접 수정은 금지한다.
- SDK 내부 재시도는 작업 예산 안에서만 네트워크를 사용할 수 있다. 이미 시작된 SDK backoff 타이머를 앱 소유 타이머인 것처럼 제거했다고 주장하지 않는다.
- 외부 취소 신호를 존중하고 호출자 Request/AbortController는 변경하지 않는다. 작업 사이 타이머·취소 상태를 공유하지 않는다.
- 외부 작업 취소는 원격 변경 롤백이 아니다. 불확실한 가입·비밀번호 변경·갱신을 자동 재전송하지 않는다.
- 공용 AuthProviderPort 및 반환 타입은 유지한다. 변경 함수에는 한국어 역할·매개변수·반환·실패/취소 설명을 붙인다.
- 기존 `.gitignore` 수정은 보존하고 커밋 대상에서 제외한다. 커밋·푸시·PR·병합·배포는 각각 승인된 범위에서만 진행한다.
- 기존 coverage branches 91.86% / 기준 100% 미달을 숨기거나 기준을 낮추지 않는다. 이는 2026-09-14 측정값이며 이번 구현 검증 결과가 아니다.

## 0. 현재 상태와 파일 지도

2026-09-15: Task 1과 Task 2, review round 1 뒤 최종 검토에서 발견한 malformed JSON 경계 보완을 구현했다. 보완 후 컨트롤러의 전체 verify는 937개 테스트·lint·typecheck·API/web build가 통과했다(exit 0). 전체 web coverage는 569개 테스트가 통과했지만 branches 92.48% 대 100% gate로 exit 1이며 scoped 최종 재검토는 APPROVED이며 malformed JSON Important finding은 해결됐다. Coverage gate 실패는 별도로 유지한다. 915개 verify·547개 coverage는 최종 보완 전 이력이다. 아래 코드 블록은 역사적 구현 지침이며 실제 실행 증거는 문서 끝에 누적한다.

| 파일 | 구분 | 책임/변경 내용 |
| --- | --- | --- |
| `apps/web/src/server/auth/supabase/provider-request-deadline.ts` | 추가 | 작업 타이머·단조 시계·취소·종료 상태 |
| `apps/web/src/server/auth/supabase/provider-operation.ts` | 추가 | 안전한 전송·본문 읽기·작업 실행 경계 |
| `apps/web/src/server/auth/supabase/sdk-client.ts` | 수정 | SDK 팩토리에 작업 전용 fetch 연결 |
| `apps/web/src/server/auth/supabase-auth-adapter.ts` | 수정 | 입력 검증 후 작업 생성, 순차 호출 경계 검사 |
| `apps/web/src/server/auth/supabase/provider-request-deadline.test.ts` | 추가 | 시간 경계·취소·정리·동시성 단위 테스트 |
| `apps/web/src/server/auth/supabase/provider-operation.test.ts` | 추가 | 전송·본문·외부 신호·늦은 결과 검사 |
| `apps/web/src/server/auth/supabase/provider-sdk-deadline.test.ts` | 추가 | 실제 SDK + 통제된 fetch 통합 검사 |
| `apps/web/src/server/auth/supabase-auth-adapter-deadline.test.ts` | 추가 | 모든 작업 진입점·순차 SDK 호출 검사 |
| `apps/web/src/server/auth/supabase-auth-adapter.test.ts` | 수정 | 기존 SDK 옵션 검증에 fetch 인자 추가 |
| `apps/web/vitest.config.ts` | 수정 | 새 제품 모듈 두 개 coverage 포함 |
| `docs/architecture/backend-authentication.ko.md` | 수정 | 실제 구현 후 호출 순서·보안 경계 설명 |
| `docs/guides/security-auth-testing.md` | 수정 | RED/GREEN·전체 검증·미검증 조건 기록 |
| `docs/status/2026-08-24-development-progress.ko.md` | 수정 | 실제 완료 범위와 다음 단계 갱신 |
| 이 실행 계획 | 수정 | 단계별 실행 결과 기록 |

구현 예상은 제품 4파일, 테스트 5파일, 설정 1파일, 문서 4파일의 **14파일**이다. 기존 `http-client.ts`에는 이미 fetch 주입점이 있어 변경할 필요가 없다. 테스트 fixture·오류 매핑·공용 계약도 현 단계에서는 변경하지 않는다. 제품 추가/수정 약 180~300줄, 테스트 약 250~450줄을 예상하되 가독성과 검증을 위해 줄 수를 억지로 줄이지 않는다. 단순 CSS 수정이 아니라 인증 실패 동작을 바꾸는 중간 규모 보안 작업이다.

최초 구현 직후 파일 길이는 어댑터 276줄, Task 1 신규 제품 모듈 79줄·93줄이며, 신규 테스트 4파일은 기존 adapter assertion 수정 전 합계 533줄이었다. Task 2 리뷰 round 1에서 실제 SDK의 adapter 매핑 전 응답 검사를 57줄 추가해 현재 신규 테스트 합계는 590줄이다. 테스트 추정 250~450줄을 넘은 이유는 실제 SDK의 전송·본문 오류, 주입 신호 취소, backoff 이후 무전송, 모든 진입점, 두 단계 공유 예산을 각각 독립 경계로 검증하고 한국어 역할 주석을 유지했기 때문이다. 정책이나 제품 범위를 추가한 결과는 아니다.

## Task 1: 독립적인 시간 제한·안전한 전송 경계

**Files:** 위 지도의 `provider-request-deadline.ts`, `provider-operation.ts`, 대응하는 두 테스트, `vitest.config.ts`.

**Interfaces:**

```ts
export const AUTH_PROVIDER_DEADLINE_MS = 5_000;
export type ProviderDeadline = Readonly<{
  signal: AbortSignal;
  assertActive(): void;
  fail(): void;
  wait<T>(work: () => Promise<T>): Promise<T>;
  close(): void;
}>;
export function createProviderDeadline(): ProviderDeadline;
export type ProviderOperation = Readonly<{
  fetch: typeof fetch;
  assertActive(): void;
}>;
export function runProviderOperation<T>(
  fetcher: typeof fetch,
  work: (operation: ProviderOperation) => Promise<T>,
): Promise<T>;
```

- [x] **1.1 시간 경계 RED 테스트를 먼저 추가한다.** `provider-request-deadline.test.ts`의 최소 시작점:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProviderDeadline } from "./provider-request-deadline.js";
vi.mock("server-only", () => ({}));
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(() => vi.useRealTimers());

it("accepts 4999ms but aborts and rejects at 5000ms", async () => {
  const deadline = createProviderDeadline();
  const result = deadline.wait(() => new Promise<never>(() => {}));
  const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  await vi.advanceTimersByTimeAsync(4_999);
  expect(deadline.signal.aborted).toBe(false);
  expect(() => deadline.assertActive()).not.toThrow();
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(deadline.signal.aborted).toBe(true);
  expect(() => deadline.assertActive()).toThrow("AUTH_PROVIDER_UNAVAILABLE");
  deadline.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps concurrent operations isolated and clears its timer", () => {
  const first = createProviderDeadline();
  const second = createProviderDeadline();
  first.fail();
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
  second.close();
  first.close();
  expect(vi.getTimerCount()).toBe(0);
});
```

- [x] **1.2 RED를 실행하고 사유를 기록한다.** 고정 도구 경로를 PATH 앞에 추가한 뒤 실행한다.

```powershell
$env:PATH = "$env:TEMP\codex-node-v22.15.1-win-x64;$env:PATH"
pnpm --filter @account-book/web exec vitest run src/server/auth/supabase/provider-request-deadline.test.ts
```

예상: 새 모듈이 아직 없으므로 import 실패. 환경/권한 실패는 RED로 간주하지 않는다.

- [x] **1.3 시간 관리 모듈을 구현한다.** `AuthProviderError`는 `../auth-provider-port.js`에서 가져온다. 각 함수의 한국어 JSDoc을 추가한다. 구현 뼈대는 다음과 같다.

```ts
import "server-only";
import { AuthProviderError } from "../auth-provider-port.js";

export const AUTH_PROVIDER_DEADLINE_MS = 5_000;
export type ProviderDeadline = Readonly<{
  signal: AbortSignal;
  assertActive(): void;
  fail(): void;
  wait<T>(work: () => Promise<T>): Promise<T>;
  close(): void;
}>;

export function createProviderDeadline(): ProviderDeadline {
  const controller = new AbortController();
  const expiresAt = performance.now() + AUTH_PROVIDER_DEADLINE_MS;
  let active = true;
  let rejectStopped!: (error: AuthProviderError) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  void stopped.catch(() => undefined);
  const fail = (): void => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    controller.abort();
    rejectStopped(new AuthProviderError());
  };
  const timer = setTimeout(fail, AUTH_PROVIDER_DEADLINE_MS);
  const assertActive = (): void => {
    if (active && performance.now() >= expiresAt) fail();
    if (!active) throw new AuthProviderError();
  };
  return {
    signal: controller.signal,
    assertActive,
    fail,
    wait: <T>(work: () => Promise<T>): Promise<T> => Promise.race([
      Promise.resolve().then(() => { assertActive(); return work(); }),
      stopped,
    ]),
    close: (): void => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    },
  };
}
```

`close()`는 외부 작업 경계의 `finally`에서만 사용한다. 진행 중 취소는 반드시 `fail()`로 처리해 대기 중인 호출도 거절한다. 이벤트 루프 지연으로 타이머 콜백이 늦어져도 `assertActive()`가 만료 시각을 재검사한다.

- [x] **1.4 본문 읽기까지의 RED 테스트를 추가한다.** `provider-operation.test.ts`는 위 테스트와 같은 fake timer 설정을 사용한다.

```ts
import { runProviderOperation } from "./provider-operation.js";

it("aborts transport when headers arrive but the body stalls", async () => {
  let signal: AbortSignal | null | undefined;
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    signal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>());
  });
  const result = runProviderOperation(fetcher, async (operation) => {
    const response = await operation.fetch("https://project.supabase.co/auth/v1/token");
    return response.json();
  });
  const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  expect(signal?.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves a provider 429 but hides a raw transport error", async () => {
  const limited = vi.fn<typeof fetch>(async () => new Response("{}", { status: 429 }));
  await expect(runProviderOperation(limited, async (op) => (await op.fetch("https://example.test")).status)).resolves.toBe(429);
  const broken = vi.fn<typeof fetch>(async () => { throw new Error("secret-token-in-raw-error"); });
  await expect(runProviderOperation(broken, async (op) => op.fetch("https://example.test"))).rejects.toMatchObject({
    message: "AUTH_PROVIDER_UNAVAILABLE", code: "AUTH_PROVIDER_UNAVAILABLE",
  });
});
```

실행: `pnpm --filter @account-book/web exec vitest run src/server/auth/supabase/provider-operation.test.ts`. 새 모듈이 없는 상태의 RED를 기록한다.

- [x] **1.5 전송 모듈을 구현한다.** 작업 실패 상태와 SDK 전달용 고정 응답을 함께 사용한다. 내부 408은 브라우저 HTTP 정책이 아니며 SDK의 네트워크 오류 자동 재시도를 유발하지 않는 내부 경계 값이다.

```ts
import "server-only";
import { rethrowProviderError } from "./error-mapper.js";
import { createProviderDeadline, type ProviderDeadline } from "./provider-request-deadline.js";

export type ProviderOperation = Readonly<{ fetch: typeof fetch; assertActive(): void }>;

function unavailableResponse(): Response {
  return new Response('{"message":"AUTH_PROVIDER_UNAVAILABLE"}', {
    status: 408, headers: { "content-type": "application/json" },
  });
}

function guardedFetch(fetcher: typeof fetch, deadline: ProviderDeadline): typeof fetch {
  return async (input, init) => {
    const external = init?.signal === undefined
      ? (input instanceof Request ? input.signal : undefined)
      : init.signal;
    const onAbort = (): void => deadline.fail();
    external?.addEventListener("abort", onAbort, { once: true });
    try {
      if (external?.aborted) deadline.fail();
      const response = await deadline.wait(() => {
        const pending = fetcher(input, { ...init, signal: deadline.signal });
        void pending.then((late) => {
          if (deadline.signal.aborted) void late.body?.cancel().catch(() => undefined);
        }, () => undefined);
        return pending;
      });
      const bytes = await deadline.wait(() => response.arrayBuffer());
      deadline.assertActive();
      return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } catch {
      deadline.fail();
      return unavailableResponse();
    } finally {
      external?.removeEventListener("abort", onAbort);
    }
  };
}

export async function runProviderOperation<T>(
  fetcher: typeof fetch,
  work: (operation: ProviderOperation) => Promise<T>,
): Promise<T> {
  const deadline = createProviderDeadline();
  try {
    const result = await deadline.wait(() => work({
      fetch: guardedFetch(fetcher, deadline), assertActive: deadline.assertActive,
    }));
    deadline.assertActive();
    return result;
  } catch (error) {
    return rethrowProviderError(error);
  } finally {
    deadline.close();
  }
}
```

응답을 먼저 끝까지 읽는 이유는 SDK 내부의 `response.json()`까지 전송 예산과 오류 차단으로 감싸기 위해서다. 실제 HTTP 상태·본문·헤더는 정상적으로 읽혔을 때 보존한다. 본문 메모리 복사 비용이 추가되므로 금융 내역 다운로드 같은 큰 응답에 재사용하지 않는다. 별도 응답 크기 제한 정책을 이번에 몰래 추가하지 않는다.

- [x] **1.6 경계 사례를 표 기반 테스트로 추가한다.** 위 테스트 harness에서 다음 입력/기대값을 고정한다. 각 테스트를 먼저 실행해 해당 보호가 빠졌을 때 실패함을 확인한다.

```ts
it.each(["init", "request"] as const)("honors %s cancellation without aborting the caller controller", async (source) => {
  const external = new AbortController();
  const remove = vi.spyOn(external.signal, "removeEventListener");
  const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
  const input = source === "request"
    ? new Request("https://example.test", { signal: external.signal }) : "https://example.test";
  const result = runProviderOperation(fetcher, (op) => op.fetch(input,
    source === "init" ? { signal: external.signal } : undefined));
  const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  await vi.advanceTimersByTimeAsync(0);
  external.abort();
  await rejected;
  if (source === "init") expect(remove).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not abort the caller controller on its own timeout", async () => {
  const external = new AbortController();
  const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
  const result = runProviderOperation(fetcher, (op) => op.fetch("https://example.test", { signal: external.signal }));
  const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  expect(external.signal.aborted).toBe(false);
});
```

같은 파일에 다음 두 실제 코드 패턴도 넣는다. 첫 번째는 작업 종료 후 후속 SDK fetch가 실제 전송을 못 하게 하는지, 두 번째는 시스템 시계가 아닌 단조 시계 재검사를 확인한다.

```ts
it("never starts a late transport after the operation settled", async () => {
  let retained!: typeof fetch;
  const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));
  await runProviderOperation(fetcher, async (op) => { retained = op.fetch; });
  expect((await retained("https://example.test")).status).toBe(408);
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects a success at the exact monotonic deadline", async () => {
  const now = vi.spyOn(performance, "now");
  now.mockReturnValue(0);
  const fetcher = vi.fn<typeof fetch>();
  const result = runProviderOperation(fetcher, async () => { now.mockReturnValue(5_000); return "late"; });
  await expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  now.mockRestore();
});
```

- [x] **1.7 GREEN·타입·coverage 연결을 확인한다.** `vitest.config.ts`의 include에 다음 두 항목을 추가한다.

```ts
"src/server/auth/supabase/provider-request-deadline.ts",
"src/server/auth/supabase/provider-operation.ts",
```

실행: `pnpm --filter @account-book/web exec vitest run src/server/auth/supabase/provider-request-deadline.test.ts src/server/auth/supabase/provider-operation.test.ts`, 이어서 `pnpm typecheck`와 `pnpm lint`. 타이머·외부 리스너 정리, 실패 promise 관찰, 204 무본문 응답도 확인한다. 아직 어댑터에 연결하지 않았으므로 기존 인증 동작은 이 단계에서 바뀌지 않는다. 승인된 커밋 범위가 있을 때만 Task 1 파일을 명시적으로 스테이징한다.

## Task 2: 기존 어댑터 연결·실제 SDK 회귀 검증·한국어 문서

**Files:** `sdk-client.ts`, `supabase-auth-adapter.ts`, `supabase-auth-adapter.test.ts`, 새 adapter/SDK deadline 테스트, 파일 지도에 적힌 문서 4개.

**Interfaces:** Task 1의 `runProviderOperation<T>(fetcher, work): Promise<T>`와 `ProviderOperation.fetch/assertActive`를 소비한다. 기존 `AuthProviderPort`를 그대로 제공한다. SDK 팩토리만 선택적 네 번째 인자를 받는다.

- [x] **2.1 실제 SDK RED를 먼저 쓴다.** `provider-sdk-deadline.test.ts`에서는 SDK 모듈을 mock하지 않는다. `server-only`만 mock하고 Task 1과 같은 fake timer lifecycle을 사용한다. `SupabaseAuthAdapter`는 `../supabase-auth-adapter.js`, fixture는 `./test-fixtures.js`에서 가져온다.

```ts
it("hides raw transport secrets before the real SDK can log them", async () => {
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("password-and-refresh-token-canary"); });
  const subject = new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, undefined, fetcher);
  try {
    await expect(subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) })).rejects.toMatchObject({
      message: "AUTH_PROVIDER_UNAVAILABLE", code: "AUTH_PROVIDER_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(errorLog).not.toHaveBeenCalled();
  } finally { errorLog.mockRestore(); }
});

it("bounds the real SDK refresh backoff without starting late network calls", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 }));
  const subject = new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, undefined, fetcher);
  const result = subject.refresh("refresh-token");
  const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  const callsAtDeadline = fetcher.mock.calls.length;
  expect(callsAtDeadline).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetcher).toHaveBeenCalledTimes(callsAtDeadline);
});
```

**RED 실행 안전성:** 현재 기본 SDK 팩토리는 주입 fetch를 사용하지 않으므로 위 테스트를 그대로 먼저 돌리면 외부 통신을 시도한다. 테스트 `beforeEach`에서 `vi.stubGlobal("fetch", fetcher)`로 동일한 통제된 fetch를 등록하고 `afterEach`에서 `vi.unstubAllGlobals()`를 호출한다. 두 테스트 모두 fetcher를 만든 직후 stub을 적용한다. 실제 SDK 유지와 실제 외부 접속은 다른 조건이다. SDK timer가 남는 RED는 Vitest 테스트 제한 안에서 종료하고 실패 원인을 기록한다.

- [x] **2.2 공유 5초 RED를 추가한다.** 새 `supabase-auth-adapter-deadline.test.ts`에서 기존 fixture `client`, `ok`, `session`, `accessToken`, `userId`를 사용한다.

```ts
it.each(["signOut", "updatePassword"] as const)("shares one budget across setSession and %s", async (method) => {
  const sdk = client({
    setSession: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(ok({ session })), 4_000))),
    signOut: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(ok({})), 2_000))),
    updateUser: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(ok({ user: session.user })), 2_000))),
  });
  const subject = new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, () => sdk);
  const result = method === "signOut"
    ? subject.signOut(accessToken, "refresh-token")
    : subject.updatePassword({ accessToken, refreshToken: "refresh-token", userId, password: "b".repeat(12) });
  const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  await vi.advanceTimersByTimeAsync(1_000);
  expect(method === "signOut" ? sdk.auth.signOut : sdk.auth.updateUser).toHaveBeenCalledTimes(1);
});
```

실행: `pnpm --filter @account-book/web exec vitest run src/server/auth/supabase/provider-sdk-deadline.test.ts src/server/auth/supabase-auth-adapter-deadline.test.ts`. RED에서도 실제 외부 통신을 하지 않는지 확인한다.

- [x] **2.3 SDK 생성 지점을 연결한다.** 기존 옵션 객체·SupabaseClient 타입은 유지한다.

```ts
export type SupabaseClientFactory = (
  url: string, anonKey: string, auth: typeof AUTH_OPTIONS, fetcher?: typeof fetch,
) => SupabaseClient;

export const defaultSupabaseClientFactory: SupabaseClientFactory = (url, anonKey, auth, fetcher = fetch) =>
  createClient(url, anonKey, { auth, global: { fetch: fetcher } }) as unknown as SupabaseClient;
```

기존 3인자 팩토리 대역은 호환된다. 생성 주석에 fetcher의 역할·오류 차단 책임을 설명한다. 어댑터 `client`는 다음 형태로 바꾼다.

```ts
private client(fetcher: SupabaseFetch): SupabaseClient {
  return this.factory(this.config.url, this.config.anonKey, AUTH_OPTIONS, fetcher);
}
```

- [x] **2.4 어댑터의 SDK 경로를 감싼다.** `runProviderOperation`을 새 모듈에서 import한다. 각 메서드의 기존 try/catch와 입력 오류 처리는 유지한다. 검증된 변수는 작업 시작 전에 만들고 네트워크/파싱은 콜백 안에 둔다.

```ts
// signInWithPassword: 기존 parsed.success 검사 다음부터 교체.
return await runProviderOperation(this.fetcher, async (op) =>
  tokenPair(dataOf(await this.client(op.fetch).auth.signInWithPassword(parsed.data)).session));

// refresh: 외부 호출 전에 토큰 검증.
const refresh = token(refreshToken);
return await runProviderOperation(this.fetcher, async (op) =>
  tokenPair(dataOf(await this.client(op.fetch).auth.refreshSession({ refresh_token: refresh })).session));

// signOut: setSession + signOut은 한 작업.
const tokens = { access_token: token(accessToken), refresh_token: token(refreshToken) };
return await runProviderOperation(this.fetcher, async (op) => {
  const client = this.client(op.fetch);
  dataOf(await client.auth.setSession(tokens));
  op.assertActive();
  accepted(await client.auth.signOut());
});

// updatePassword: 기존 password/expectedUserId 검증 다음부터 교체.
const tokens = { access_token: token(input?.accessToken), refresh_token: token(input?.refreshToken) };
return await runProviderOperation(this.fetcher, async (op) => {
  const client = this.client(op.fetch);
  const pair = tokenPair(dataOf(await client.auth.setSession(tokens)).session);
  if (pair.userId !== expectedUserId) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
  op.assertActive();
  accepted(await client.auth.updateUser({ password: password.data.password }));
});
```

`return await`는 기존 catch가 비동기 거절까지 받도록 유지한다. SDK를 캐시하지 않고 작업마다 새로 만든다.

- [x] **2.5 직접 HTTP 경로를 감싼다.** `http-client.ts` 함수는 변경하지 않고 인자로 작업 fetch를 전달한다.

```ts
// signUp: parsed와 callback 검증 후 body를 구성하고 작업을 시작.
const body = { email: parsed.data.email, password: parsed.data.password,
  code_challenge: challenge(codeChallenge), code_challenge_method: "s256" };
return await runProviderOperation<EmailAuthResult>(this.fetcher, async (op) => {
  const result = await postSupabaseAuth(this.config, op.fetch, "signup", body, callback);
  if (!result.ok && !isSignupExistenceResponse(result.body, result.status)) {
    throw mappedProviderError(result.body, result.status);
  }
  return { status: "verification_required" };
});

// requestPasswordReset: parsed 검증 후 로컬 값 먼저 검증.
const callback = safeUrl(redirectUrl, true);
const body = { email: parsed.data.email, code_challenge: challenge(codeChallenge), code_challenge_method: "s256" };
return await runProviderOperation(this.fetcher, async (op) => {
  const result = await postSupabaseAuth(this.config, op.fetch, "recover", body, callback);
  if (!result.ok && !isResetAbsenceResponse(result.body, result.status)) throw mappedProviderError(result.body, result.status);
});

// exchange: 기존 url + grant_type 구성 후 로컬 검증을 먼저 완료.
const body = { auth_code: code(authCode), code_verifier: verifier(codeVerifier) };
return await runProviderOperation(this.fetcher, async (op) => {
  const result = await requestSupabaseAuth(this.config, op.fetch, url, body);
  if (!result.ok) throw mappedProviderError(result.body, result.status, true);
  return rawTokenPair(result.body);
});
```

`confirmEmail`·`exchangeOAuthCode`·`exchangeRecoveryCode`는 기존 공통 exchange 위임을 유지한다. recovery의 단순 필드 투영은 원시 세션 검증 후 네트워크 없이 수행한다. 공개 OAuth URL 생성에는 새로운 래퍼를 넣지 않는다.

- [x] **2.6 기존 단언을 보존하며 새 fetch 인자만 검증한다.** `supabase-auth-adapter.test.ts`의 factory 호출 단언:

```ts
expect(call).toEqual([
  "https://project.supabase.co/", "anon-key",
  { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "pkce" },
  expect.any(Function),
]);
```

새 adapter 테스트에 가입·복구 요청·confirmEmail·OAuth 교환·recovery 교환·로그인·refresh 각 진입점의 영구 대기를 표 기반으로 실행한다. 직접 HTTP는 1회 전송, SDK 대역 경로는 전송 0회이며 실제 SDK 전송은 별도 SDK 테스트로 검사한다. 기존 사용자 불일치·429·미확인·PKCE·계정 열거 방지 테스트를 삭제하지 않는다. `challenge`, `verifier`는 기존 fixture에서 가져온다.

```ts
const operations: Record<string, (subject: SupabaseAuthAdapter) => Promise<unknown>> = {
  signUp: (s) => s.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/auth/confirm"), challenge),
  recover: (s) => s.requestPasswordReset("person@example.test", new URL("https://app.example.test/auth/recovery"), challenge),
  confirm: (s) => s.confirmEmail({ code: "code", codeVerifier: verifier }),
  oauth: (s) => s.exchangeOAuthCode({ code: "code", codeVerifier: verifier }),
  recoveryExchange: (s) => s.exchangeRecoveryCode({ code: "code", codeVerifier: verifier }),
  signIn: (s) => s.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }),
  refresh: (s) => s.refresh("refresh-token"),
};
it.each(Object.entries(operations))("bounds the %s entry point", async (name, invoke) => {
  const stall = (): Promise<never> => new Promise(() => {});
  const sdk = client({ signInWithPassword: vi.fn(stall), refreshSession: vi.fn(stall) });
  const fetcher = vi.fn<typeof fetch>(stall);
  const subject = new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, () => sdk, fetcher);
  const result = invoke(subject);
  const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(["signIn", "refresh"].includes(name) ? 0 : 1);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not start signOut after a late setSession success", async () => {
  const sdk = client({ setSession: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(ok({ session })), 6_000))) });
  const subject = new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, () => sdk);
  const result = subject.signOut(accessToken, "refresh-token");
  const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sdk.auth.signOut).not.toHaveBeenCalled();
});

it("keeps invalid input and OAuth URL construction outside the deadline", async () => {
  const sdk = client();
  const fetcher = vi.fn<typeof fetch>();
  const timer = vi.spyOn(globalThis, "setTimeout");
  const subject = new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, () => sdk, fetcher);
  await expect(subject.signInWithPassword({ email: "invalid", password: "short" })).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
  await subject.startOAuth({ provider: "google", redirectUrl: new URL("https://app.example.test/auth/oauth"), codeChallenge: challenge });
  expect(fetcher).not.toHaveBeenCalled();
  expect(timer).not.toHaveBeenCalled();
  timer.mockRestore();
});
```

- [x] **2.7 통합 GREEN 및 상위 정책 회귀를 확인한다.** 다음 명령과 실제 종료 코드·테스트 수를 기록한다.

```powershell
pnpm --filter @account-book/web exec vitest run src/server/auth/supabase src/server/auth/supabase-auth-adapter.test.ts src/server/auth/supabase-auth-adapter-deadline.test.ts src/server/auth/email-auth-service.test.ts src/server/auth/password-recovery-service.test.ts src/server/session/session-service.test.ts
pnpm verify
pnpm --filter @account-book/web exec vitest run --coverage
git diff --check
```

상위 복구 테스트의 `AUTH_PROVIDER_UNAVAILABLE` → claim 유지·consumed 없음·세션 폐기 없음·재사용 차단을 유지한다. 로그인 실패 후 로컬 세션 생성 금지, 로그아웃 로컬 폐기 우선 정책, 갱신 실패의 토큰 회전 실패 처리도 기존 테스트로 재확인한다. 새 실패가 생기면 임계값을 완화하지 않고 원인을 조사한다. 실제 SDK backoff 테스트는 호출자 반환 시점과 SDK 내부 타이머 소진 시점을 구별한다.

- [x] **2.8 독립 리뷰와 문서를 마친다.** 요구사항 리뷰 후 보안/코드 품질 리뷰를 받는다. 위 14파일만 변경됐는지, 공용 계약·의존성·화면이 유지됐는지 확인한다. 문서에는 다음 내용을 실제 결과로 교체해 기록한다.

```text
작업 흐름: 로컬 입력 검증 → 5초 예산 생성 → 작업 전용 SDK/HTTP → 본문 읽기 → 응답 검증 → 타이머/리스너 정리.
실패 의미: 시간이 끝나면 실제 전송을 취소하고 AUTH_PROVIDER_UNAVAILABLE만 전달한다. 제공자에서 이미 처리했는지는 확정할 수 없으므로 자동 재시도하지 않는다.
구조: provider-request-deadline은 시계·수명, provider-operation은 전송·오류 차단, adapter는 인증 절차, sdk-client는 새 SDK 생성만 맡는다.
검증 증거: RED와 GREEN의 명령·실제 종료 코드·실행 시각·테스트 수, 전체 verify 및 coverage 결과를 각각 기록한다.
미검증: 실제 hosted IdP/DB 전체 E2E, 배포 네트워크에서의 취소, 한국망 지연 p95는 별도다. 통제된 fetch 테스트를 실제 서비스 실측으로 표현하지 않는다.
```

이 단계 완료 후 사용자에게 결과·남은 위험을 보고하고, 승인된 경우에만 커밋·푸시로 이어간다. 커밋할 때 `git add .` 대신 파일 지도에서 실제 변경한 파일을 명시한다.

## 자체 점검과 실행 인계

- 설계 1~3절: Task 1의 공통 deadline/전송, Task 2의 모든 작업 연결에 대응한다.
- 설계 4~5절: 고정 실패 상태·내부 408·SDK 로그/재시도 테스트·상위 claim/폐기 회귀로 대응한다.
- 설계 6~8절: 파일 지도·실행 결과 문서·coverage 기준 유지·새 범위 승인 절차로 대응한다.
- Task 1이 제공하는 `runProviderOperation`·`ProviderOperation`을 Task 2가 동일한 이름과 타입으로 사용한다.
- 계획의 코드 예시는 구현 전에 한국어 함수/매개변수 주석을 추가하고 타입 검사로 검증한다. 계획 문서 작성만으로 컴파일·테스트 통과를 주장하지 않는다.
- 구현 방식은 **작업별 서브에이전트 구현 → 요구사항 리뷰 → 코드 리뷰**를 권장한다. 같은 세션에서 직접 두 작업을 차례로 실행하는 방식도 가능하다. A안·5초를 재선택할 필요는 없다.

## 실행 결과

2026-09-15: 실행 계획과 문서 연결만 작성했다. 제품 변경·새 테스트 실행·커밋·푸시·PR·병합·배포는 수행하지 않았다. 구현 결과는 각 체크박스 실행 후 이 절에 추가한다.

2026-09-15 Task 1 구현 결과: 시간 제한과 보호된 전송 모듈, 두 테스트, coverage include가 구현됐다. focused 19개 테스트와 typecheck·lint가 모두 종료 코드 0이었고, 요구사항·품질 리뷰는 모두 Approved였다. 구현 전 기준선의 인증 어댑터 64개와 상위 정책 94개 테스트 통과는 기준선 증거이며 현재 통합 소스의 전체 검증으로 재사용하지 않는다.

2026-09-15 Task 2 구현 결과: 실제 SDK를 mock하지 않은 RED는 10:51 KST에 2개 파일 16개 중 15개 실패·1개 통과, 종료 코드 1이었다. SDK는 외부망 대신 별도 통제 전역 fallback만 사용했고, 실패는 작업 fetch 미주입과 작업 예산 부재를 정확히 드러냈다. 구현 뒤 10:53 KST 동일 명령은 2개 파일 16개 모두 통과했고 종료 코드 0이었다. 실제 SDK 경계에서 원시 전송·본문 오류 표식이 console.error에 도달하지 않고 고정 가용성 오류가 되며, 주입 신호가 5초에 중단되고 refresh backoff 뒤 늦은 전송이 시작되지 않는 것을 확인했다.

통합·상위 정책 회귀는 10:53 KST에 controller 테스트를 포함한 11개 파일 193개가 모두 통과했고 종료 코드 0이었다. 10:54 KST web typecheck와 전체 lint도 각각 종료 코드 0이었다. 따라서 가입·로그인·세션 갱신·로그아웃·복구의 기존 오류 매핑, claim/폐기/회전 정책을 focused 범위에서 보존한다.

Task 2 리뷰 round 1 전 소스에 대한 컨트롤러의 전체 `pnpm verify`는 종료 코드 0이다. lint·workspace typecheck·API 및 Next.js 16.3.3 build가 통과했고, legacy 54 + contracts 66 + database 15 + API 148 + web 545 + E2E preflight 85 = 총 913개 테스트가 통과했다. E2E preflight는 hosted IdP/DB나 브라우저 실측이 아니다. 원본 로그는 `.superpowers/sdd/2026-09-15-auth-provider-deadline/full-verify.log`, 인계용 복사본은 `output/auth-provider-deadline-full-verify.log`다.

같은 리뷰 전 소스에 대한 2026-09-15 11:01:42 KST의 `pnpm --filter @account-book/web exec vitest run --coverage`는 7.41초 동안 32개 파일·545개 테스트를 모두 통과시켰지만 coverage gate 때문에 종료 코드 1이었다. 실제 수치는 statements 95.01% (839/883), branches 92.54% (757/818), functions 96.92% (189/195), lines 98.73% (704/713)다. branches는 이전 91.86%보다 높지만 기준 100%는 그대로이며, 신규 `provider-operation.ts`도 branches 90%여서 전체 격차를 기존 코드만의 문제로 돌리지 않는다. 로그는 `.superpowers/sdd/2026-09-15-auth-provider-deadline/coverage.log`와 `output/auth-provider-deadline-coverage.log`에 있다.

Task 2 리뷰 round 1은 최종 어댑터 오류와 `console.error`만으로는 실제 SDK가 받은 내부 응답의 안전성을 증명하지 못한다고 지적했다. 실제 SDK 결과를 adapter 매핑 전에 직접 관찰해 data가 null user/session이고 error가 정확한 status 408·message `AUTH_PROVIDER_UNAVAILABLE`이며 원시 canary가 없는지 단언하도록 테스트를 보강했다. 11:12:04 KST에 본문 버퍼링을 임시 우회한 mutation은 targeted 1 failed·1 passed·5 skipped, exit 1로 body status 0 대 기대 408만 실패했다. 즉시 제품 파일을 원복했고 SHA-256 `760F0EB6080752E0525E3900A775507797F785F6C021FC62B0EE25D88D4711D2`가 리뷰 snapshot과 일치했다. 11:12:32 KST SDK+operation 2 files·22 tests, 11:12:41 web typecheck, 11:12:52 lint는 모두 exit 0이다. 이 round는 테스트·문서만 영구 변경했으므로 앞의 913개·coverage 수치는 리뷰 전 소스 증거로 구분하며 전체 재실행을 주장하지 않는다.

컨트롤러가 review round 1 뒤, malformed JSON 최종 보완 전 소스를 다시 검증했다. `pnpm verify`는 exit 0이며 lint·workspace typecheck·API 및 web build가 통과했고 legacy 54 + contracts 66 + database 15 + API 148 + web 547 + E2E preflight 85 = 총 915개 테스트가 통과했다. 2026-09-15 11:16:03 KST의 coverage는 7.45초, 32개 파일·547개 테스트 통과 뒤 branches threshold 때문에 exit 1이었다. 수치는 statements 95.01% (839/883), branches 92.54% (757/818), functions 96.92% (189/195), lines 98.73% (704/713)로 round 전과 동일하다. 이 보완 전 로그는 `output/auth-provider-deadline-final-verify.log`와 `output/auth-provider-deadline-final-coverage.log`다. 파일명의 final과 관계없이 915개·547개는 최종 보완 소스의 검증이 아니며, 913개·545개도 더 이른 이력으로 보존한다.

검증 명령 실행과 실패 기록을 마쳐 2.7을 완료했고, 최종 보완 후 전체 검증·독립 scoped 리뷰 APPROVED·문서 기록을 마쳐 2.8도 완료했다. 이는 coverage gate 실패를 성공으로 바꾸거나 면제한 표시가 아니다. 커밋·푸시·PR·병합·배포는 수행하지 않았다.

### 최종 보완: JSON 해석 전 SDK 원문 차단

최종 검토는 본문 스트림을 정상적으로 읽어도 JSON 구문이 잘못되면 실제 SDK가 원문 일부를 오류에 넣는 누락을 확인했다. 공개 adapter 응답은 이미 정규화되어 있었으며 공개 원문 유출이 입증된 것은 아니다. 제품 수정은 `provider-operation.ts` 하나다. 같은 작업 예산 안에서 UTF-8/JSON 해석을 먼저 확인하고, 잘못된 비-429 본문은 기존 작업 실패·abort·고정 408 경로로 보낸다. 실제 429는 본문이 잘못됐거나 비어도 고정 `AUTH_RATE_LIMITED` JSON과 429를 전달해 제한 분류를 보존한다. 유효 JSON 바이트·상태·헤더는 재직렬화 없이 유지하고 204/205/304와 성공한 빈 logout도 허용한다. 디코딩 뒤 SDK 전달 전에 단조 시계 마감을 다시 검사한다. 새 정책·endpoint 스키마·의존성은 추가하지 않았다.

TDD RED는 11:31:02 KST의 SDK/operation/adapter-deadline 3파일 54개 중 8 failed·46 passed, exit 1이었다. HTTP 200의 실제 SDK pre-map 오류는 status 0과 가짜 canary 일부였으며, 400/401/429의 잘못된 JSON도 SDK parse 오류에 원문 일부를 남겼다. 같은 명령의 11:31:47 GREEN은 54/54, exit 0이다. 빈 429 SDK 사례까지 보강한 11:32:34 focused는 55/55이고 web typecheck·workspace lint도 exit 0이다. 최초 typecheck의 테스트 `this` 타입 누락(TS2683)은 테스트에 타입만 명시한 뒤 재검증했다. 11:33:04 인증/상위 정책 회귀는 11파일 217/217, exit 0이다.

제품·테스트는 고정해 컨트롤러에 넘겼다. 구현자가 전체 verify·coverage를 중복 실행하지 않았으며 컨트롤러의 보완 후 결과는 다음과 같다. `pnpm verify` exit 0: legacy 54 + contracts 66 + database 15 + API 148 + web 569 + E2E preflight 85 = 937개 테스트, lint·workspace typecheck·API/web build 통과. 11:36:18 KST의 `pnpm --filter @account-book/web exec vitest run --coverage`는 7.59초, 32파일·569/569 통과 뒤 branches 100% gate 미충족으로 exit 1이다. statements 94.84% (846/892), branches 92.48% (763/825), functions 96.93% (190/196), lines 98.47% (711/722). `provider-operation.ts`는 branches 94.11%·lines 100%로 자체 분기 격차도 남아 있다. 기준은 낮추지 않았다. 로그는 `output/auth-provider-deadline-json-guard-verify.log`와 `output/auth-provider-deadline-json-guard-coverage.log`다. scoped 최종 재검토는 APPROVED이며 malformed JSON Important finding은 해결됐다. 새 결함이나 범위 밖 변경은 없다는 판정이고 coverage gate 실패는 별도로 유지한다. 정확한 명령·실패 차이·고정 파일 해시는 `.superpowers/sdd/2026-09-15-auth-provider-deadline/final-fix-report.md`에 기록했다.
