import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseAuthAdapter } from "../supabase-auth-adapter.js";
import { runProviderOperation } from "./provider-operation.js";
import { AUTH_OPTIONS, defaultSupabaseClientFactory } from "./sdk-client.js";
import { accessToken, rawSession, session } from "./test-fixtures.js";

vi.mock("server-only", () => ({}));

describe("SupabaseAuthAdapter real SDK deadline", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(["transport", "body"] as const)(
    "hides a raw %s secret before the real SDK can log it",
    async (source) => {
      const canary = `${source}-password-and-refresh-token-canary`;
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const globalFallback = vi.fn<typeof fetch>(async () => {
        throw new Error("controlled-global-fallback");
      });
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (source === "transport") throw new Error(canary);
        return new Response(new ReadableStream<Uint8Array>({ pull: () => { throw new Error(canary); } }));
      });
      vi.stubGlobal("fetch", globalFallback);
      const subject = new SupabaseAuthAdapter(
        { url: "https://project.supabase.co", anonKey: "anon-key" },
        undefined,
        fetcher,
      );

      try {
        await expect(subject.signInWithPassword({
          email: "person@example.test",
          password: "a".repeat(12),
        })).rejects.toMatchObject({
          message: "AUTH_PROVIDER_UNAVAILABLE",
          code: "AUTH_PROVIDER_UNAVAILABLE",
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(globalFallback).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
      } finally {
        errorLog.mockRestore();
      }
    },
  );

  it.each(["transport", "body"] as const)(
    "gives the real SDK a fixed 408 before adapter error mapping for a raw %s failure",
    async (source) => {
      const canary = `${source}-premap-secret-canary`;
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const globalFallback = vi.fn<typeof fetch>(async () => {
        throw new Error("controlled-global-fallback");
      });
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (source === "transport") throw new Error(canary);
        return new Response(new ReadableStream<Uint8Array>({ pull: () => { throw new Error(canary); } }));
      });
      vi.stubGlobal("fetch", globalFallback);

      try {
        let resolveSdkResult!: (value: unknown) => void;
        let rejectSdkResult!: (reason: unknown) => void;
        const sdkResult = new Promise<unknown>((resolve, reject) => {
          resolveSdkResult = resolve;
          rejectSdkResult = reject;
        });
        const adapterBoundary = runProviderOperation(fetcher, async (operation) => {
          const sdk = defaultSupabaseClientFactory(
            "https://project.supabase.co",
            "anon-key",
            AUTH_OPTIONS,
            operation.fetch,
          );
          const pending = sdk.auth.signInWithPassword({
            email: "person@example.test",
            password: "a".repeat(12),
          });
          void pending.then(resolveSdkResult, rejectSdkResult);
          return pending;
        });
        const boundarySettled = adapterBoundary.catch(() => undefined);
        const result = await sdkResult as {
          data?: { user?: unknown; session?: unknown };
          error?: { message?: unknown; status?: unknown };
        };

        expect(result.data).toEqual({ user: null, session: null });
        expect(result.error?.status).toBe(408);
        expect(result.error?.message).toBe("AUTH_PROVIDER_UNAVAILABLE");
        expect(result.error?.message).not.toContain(canary);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(globalFallback).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
        await boundarySettled;
      } finally {
        errorLog.mockRestore();
      }
    },
  );

  it.each([
    ["malformed success", 200, "CANARY_PRIVATE_TOKEN_invalid_json", 408, "AUTH_PROVIDER_UNAVAILABLE"],
    ["malformed credentials failure", 400, "CANARY_PRIVATE_TOKEN_invalid_json", 408, "AUTH_PROVIDER_UNAVAILABLE"],
    ["malformed unauthorized failure", 401, "CANARY_PRIVATE_TOKEN_invalid_json", 408, "AUTH_PROVIDER_UNAVAILABLE"],
    ["malformed rate limit", 429, "CANARY_PRIVATE_TOKEN_invalid_json", 429, "AUTH_RATE_LIMITED"],
    ["empty rate limit", 429, "", 429, "AUTH_RATE_LIMITED"],
    ["valid rate limit", 429, '{"message":"rate limited"}', 429, "rate limited"],
  ] as const)("protects the real SDK pre-map result for %s", async (_name, status, body, wantStatus, wantMessage) => {
    // 본문 읽기는 성공하고 JSON 해석만 실패하는 실제 Response로 버퍼링만 있는 보호의 누락을 잡습니다.
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const globalFallback = vi.fn<typeof fetch>(async () => { throw new Error("controlled-global-fallback"); });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body, { status }));
    vi.stubGlobal("fetch", globalFallback);
    let resolveSdkResult!: (value: unknown) => void;
    let rejectSdkResult!: (reason: unknown) => void;
    const sdkResult = new Promise<unknown>((resolve, reject) => {
      resolveSdkResult = resolve;
      rejectSdkResult = reject;
    });
    const boundary = runProviderOperation(fetcher, async (operation) => {
      const sdk = defaultSupabaseClientFactory("https://project.supabase.co", "anon-key", AUTH_OPTIONS, operation.fetch);
      const pending = sdk.auth.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) });
      void pending.then(resolveSdkResult, rejectSdkResult);
      return pending;
    });
    const boundarySettled = boundary.catch(() => undefined);

    try {
      const result = await sdkResult as { data?: unknown; error?: { message?: string; status?: number } };
      expect(result.data).toEqual({ user: null, session: null });
      expect({ status: result.error?.status, message: result.error?.message }).toEqual({ status: wantStatus, message: wantMessage });
      expect(result.error?.message).not.toContain("CANARY_PRIVATE_TOKEN");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(globalFallback).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
      await boundarySettled;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await boundarySettled;
      errorLog.mockRestore();
    }
  });

  it.each([
    [200, "CANARY_PRIVATE_TOKEN_invalid_json", "AUTH_PROVIDER_UNAVAILABLE"],
    [400, "CANARY_PRIVATE_TOKEN_invalid_json", "AUTH_PROVIDER_UNAVAILABLE"],
    [429, "CANARY_PRIVATE_TOKEN_invalid_json", "AUTH_RATE_LIMITED"],
    [429, '{"message":"rate limited"}', "AUTH_RATE_LIMITED"],
    [400, '{"error_code":"invalid_credentials","message":"Invalid login credentials"}', "AUTH_INVALID_CREDENTIALS"],
    [400, '{"error_code":"email_not_confirmed","message":"Email not confirmed"}', "AUTH_EMAIL_VERIFICATION_REQUIRED"],
  ] as const)("preserves public classification for HTTP %s body %s", async (status, body, code) => {
    const globalFallback = vi.fn<typeof fetch>(async () => { throw new Error("controlled-global-fallback"); });
    vi.stubGlobal("fetch", globalFallback);
    const subject = new SupabaseAuthAdapter(
      { url: "https://project.supabase.co", anonKey: "anon-key" },
      undefined,
      async () => new Response(body, { status }),
    );

    await expect(subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }))
      .rejects.toMatchObject({ code, message: code });
    expect(globalFallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 204, 205] as const)("preserves real SDK empty logout success with HTTP %s", async (status) => {
    const globalFallback = vi.fn<typeof fetch>(async () => { throw new Error("controlled-global-fallback"); });
    vi.stubGlobal("fetch", globalFallback);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/user")) return new Response(JSON.stringify(session.user));
      if (String(input).includes("/logout")) return new Response(null, { status });
      throw new Error("unexpected-controlled-route");
    });
    const subject = new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, undefined, fetcher);

    await expect(subject.signOut(accessToken, "refresh-token")).resolves.toBeUndefined();
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(["/auth/v1/user", "/auth/v1/logout"]);
    expect(globalFallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves valid JSON login through the real SDK", async () => {
    const globalFallback = vi.fn<typeof fetch>(async () => { throw new Error("controlled-global-fallback"); });
    vi.stubGlobal("fetch", globalFallback);
    const subject = new SupabaseAuthAdapter(
      { url: "https://project.supabase.co", anonKey: "anon-key" }, undefined,
      async () => new Response(JSON.stringify(rawSession)),
    );

    await expect(subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }))
      .resolves.toMatchObject({ accessToken, refreshToken: "refresh-token", userId: session.user.id });
    expect(globalFallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["headers", "body"] as const)(
    "aborts a stalled real SDK %s read through the injected deadline signal",
    async (phase) => {
      let signal: AbortSignal | null | undefined;
      const aborted = vi.fn();
      const globalFallback = vi.fn<typeof fetch>(async () => {
        throw new Error("controlled-global-fallback");
      });
      const fetcher = vi.fn<typeof fetch>((_input, init) => {
        signal = init?.signal;
        signal?.addEventListener("abort", aborted, { once: true });
        if (phase === "headers") return new Promise<Response>(() => {});
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>()));
      });
      vi.stubGlobal("fetch", globalFallback);
      const subject = new SupabaseAuthAdapter(
        { url: "https://project.supabase.co", anonKey: "anon-key" },
        undefined,
        fetcher,
      );
      const result = subject.signInWithPassword({
        email: "person@example.test",
        password: "a".repeat(12),
      });
      const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

      await vi.advanceTimersByTimeAsync(5_000);

      await rejected;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(globalFallback).not.toHaveBeenCalled();
      expect(signal?.aborted).toBe(true);
      expect(aborted).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("bounds the real SDK refresh backoff without starting late network calls", async () => {
    const signals: AbortSignal[] = [];
    const globalFallback = vi.fn<typeof fetch>(async () => {
      throw new Error("controlled-global-fallback");
    });
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.signal != null) signals.push(init.signal);
      return new Response("{}", { status: 503 });
    });
    vi.stubGlobal("fetch", globalFallback);
    const subject = new SupabaseAuthAdapter(
      { url: "https://project.supabase.co", anonKey: "anon-key" },
      undefined,
      fetcher,
    );
    const result = subject.refresh("refresh-token");
    const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
    const callsAtDeadline = fetcher.mock.calls.length;
    expect(callsAtDeadline).toBeGreaterThan(0);
    expect(globalFallback).not.toHaveBeenCalled();
    expect(signals).not.toHaveLength(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(callsAtDeadline);
  });
});
