import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseAuthAdapter } from "./supabase-auth-adapter.js";
import { accessToken, challenge, client, ok, session, userId, verifier } from "./supabase/test-fixtures.js";

vi.mock("server-only", () => ({}));

describe("SupabaseAuthAdapter operation deadline", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => vi.useRealTimers());

  const operations: Record<string, (subject: SupabaseAuthAdapter) => Promise<unknown>> = {
    signUp: (subject) => subject.signUp(
      { email: "person@example.test", password: "a".repeat(12) },
      new URL("https://app.example.test/auth/confirm"),
      challenge,
    ),
    recover: (subject) => subject.requestPasswordReset(
      "person@example.test",
      new URL("https://app.example.test/auth/recovery"),
      challenge,
    ),
    confirm: (subject) => subject.confirmEmail({ code: "code", codeVerifier: verifier }),
    oauth: (subject) => subject.exchangeOAuthCode({ code: "code", codeVerifier: verifier }),
    recoveryExchange: (subject) => subject.exchangeRecoveryCode({ code: "code", codeVerifier: verifier }),
    signIn: (subject) => subject.signInWithPassword({
      email: "person@example.test",
      password: "a".repeat(12),
    }),
    refresh: (subject) => subject.refresh("refresh-token"),
  };

  it.each(Object.entries(operations))("bounds the %s entry point", async (name, invoke) => {
    const stall = (): Promise<never> => new Promise(() => {});
    const sdk = client({ signInWithPassword: vi.fn(stall), refreshSession: vi.fn(stall) });
    const fetcher = vi.fn<typeof fetch>(stall);
    const subject = new SupabaseAuthAdapter(
      { url: "https://project.supabase.co", anonKey: "anon-key" },
      () => sdk,
      fetcher,
    );
    const result = invoke(subject);
    const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(["signIn", "refresh"].includes(name) ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["signOut", "updatePassword"] as const)(
    "shares one budget across setSession and %s",
    async (method) => {
      const sdk = client({
        setSession: vi.fn(() => new Promise((resolve) => {
          setTimeout(() => resolve(ok({ session })), 4_000);
        })),
        signOut: vi.fn(() => new Promise((resolve) => {
          setTimeout(() => resolve(ok({})), 2_000);
        })),
        updateUser: vi.fn(() => new Promise((resolve) => {
          setTimeout(() => resolve(ok({ user: session.user })), 2_000);
        })),
      });
      const subject = new SupabaseAuthAdapter(
        { url: "https://project.supabase.co", anonKey: "anon-key" },
        () => sdk,
      );
      const result = method === "signOut"
        ? subject.signOut(accessToken, "refresh-token")
        : subject.updatePassword({
            accessToken,
            refreshToken: "refresh-token",
            userId,
            password: "b".repeat(12),
          });
      const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

      await vi.advanceTimersByTimeAsync(5_000);

      await rejected;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(method === "signOut" ? sdk.auth.signOut : sdk.auth.updateUser).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not start signOut after a late setSession success", async () => {
    const sdk = client({
      setSession: vi.fn(() => new Promise((resolve) => {
        setTimeout(() => resolve(ok({ session })), 6_000);
      })),
    });
    const subject = new SupabaseAuthAdapter(
      { url: "https://project.supabase.co", anonKey: "anon-key" },
      () => sdk,
    );
    const result = subject.signOut(accessToken, "refresh-token");
    const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sdk.auth.signOut).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps invalid input and OAuth URL construction outside the deadline", async () => {
    const sdk = client();
    const fetcher = vi.fn<typeof fetch>();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const subject = new SupabaseAuthAdapter(
      { url: "https://project.supabase.co", anonKey: "anon-key" },
      () => sdk,
      fetcher,
    );

    await expect(subject.signInWithPassword({
      email: "invalid",
      password: "short",
    })).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    await subject.startOAuth({
      provider: "google",
      redirectUrl: new URL("https://app.example.test/auth/oauth"),
      codeChallenge: challenge,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();
  });

  it.each(["signUp", "recover"] as const)("preserves actual malformed 429 on the direct HTTP %s path", async (name) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("CANARY_PRIVATE_TOKEN_invalid_json", { status: 429 }));
    const subject = new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, undefined, fetcher);

    await expect(operations[name]!(subject)).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", message: "AUTH_RATE_LIMITED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
