import { describe, expect, it, vi } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { NativeClient } from "./native-client";

const origin = "https://ledger.example";
const token = "A".repeat(43);
const session = {
  authenticated: true,
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  refreshAt: "2030-01-01T00:00:00.000Z",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("native HTTP boundary", () => {
  it.each([
    "http://localhost:3000",
    "https://user:pass@ledger.example",
    "https://ledger.example/path",
    "https://ledger.example?token=x",
    "https://ledger.example#x",
    "",
    "not a URL",
  ])("rejects unsafe origin %s", (value) => {
    expect(() => new NativeClient(value)).toThrow("CONFIGURATION");
  });
  it("uses fixed path, bearer, no cookies, no redirects", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      expect(request.url).toBe(`${origin}/api/native/auth/session`);
      expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(request.credentials).toBe("omit");
      expect(request.redirect).toBe("error");
      return json(session);
    });
    const client = new NativeClient(origin, fetcher);
    expect(await client.session(token)).toEqual(session);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never retries failures or exposes upstream text", async () => {
    const fetcher = vi.fn(async () =>
      json({ password: "secret-raw-text" }, 503),
    );
    await expect(
      new NativeClient(origin, fetcher).session(token),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed success", async () => {
    await expect(
      new NativeClient(origin, async () =>
        json({ ...session, accessToken: "unexpected" }),
      ).session(token),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("accepts only the strict public error envelope", async () => {
    const error = buildApiError({
      code: "AUTH_SESSION_REFRESH_REQUIRED",
      retryable: false,
    });
    await expect(
      new NativeClient(origin, async () => json(error, 401)).session(token),
    ).rejects.toMatchObject({
      code: "AUTH_SESSION_REFRESH_REQUIRED",
      status: 401,
    });
  });
  it("encodes opaque cursor instead of accepting URL input", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      expect(request.url.startsWith(`${origin}/api/native/transactions?`)).toBe(
        true,
      );
      return json({ items: [], nextCursor: null });
    });
    await new NativeClient(origin, fetcher).transactions(token, "abc_def");
  });
  it("validates credential before network", async () => {
    const fetcher = vi.fn();
    await expect(
      new NativeClient(origin, fetcher).session("bad"),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds body time as well as response headers", async () => {
    vi.useFakeTimers();
    try {
      const stream = new ReadableStream({
        start() {
          /* intentional stalled body */
        },
      });
      const pending = new NativeClient(
        origin,
        async () =>
          new Response(stream, {
            headers: { "content-type": "application/json" },
          }),
      ).session(token);
      const check = expect(pending).rejects.toMatchObject({ code: "NETWORK" });
      await vi.advanceTimersByTimeAsync(10_001);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });
});
