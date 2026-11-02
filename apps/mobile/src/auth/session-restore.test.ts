import { describe, expect, it, vi } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { NativeClient } from "../api/native-client";
import { SessionManager, SESSION_KEY, DEVICE_KEY } from "./session-manager";

const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const origin = "https://ledger.example";
const initial = {
  sessionToken: "A".repeat(43),
  session: {
    authenticated: true as const,
    userId,
    deviceId,
    refreshAt: "2099-01-01T00:00:00.000Z",
  },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function fixture() {
  const values = new Map<string, string>([
    [DEVICE_KEY, deviceId],
    [SESSION_KEY, JSON.stringify({ origin, ...initial })],
  ]);
  const storage = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  const requests: Request[] = [];
  let handler = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/auth/sign-out")) return json({ signedOut: true });
    if (path.endsWith("/auth/session/refresh"))
      return json({ ...initial, sessionToken: "B".repeat(42) + "A" });
    if (path.endsWith("/auth/session")) return json(initial.session);
    if (path.endsWith("/transactions"))
      return json({ items: [], nextCursor: null });
    throw new Error("Unexpected route");
  };
  const client = new NativeClient(origin, async (raw) => {
    const request = new Request(raw);
    requests.push(request);
    return handler(request);
  });
  const make = () => new SessionManager(client, storage, () => otherId);
  return {
    values,
    storage,
    requests,
    make,
    handle: (next: typeof handler) => {
      handler = next;
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("process restart session restoration", () => {
  it.each([DEVICE_KEY, SESSION_KEY])(
    "allows login after recovering a failed initial read of %s",
    async (key) => {
      const f = fixture(),
        manager = f.make();
      if (key === SESSION_KEY) f.storage.get.mockResolvedValueOnce(deviceId);
      f.storage.get.mockRejectedValueOnce(new Error("locked storage"));
      await manager.restore();
      expect(manager.snapshot().status).toBe("storage_error");
      await manager.signOut();
      expect(f.values.has(SESSION_KEY)).toBe(false);
      expect(manager.snapshot().status).toBe("signed_out");
      f.handle(async () => json(initial));
      await manager.signIn(
        "verified@example.test",
        "correct horse battery staple",
      );
      expect(manager.snapshot()).toEqual({ status: "ready", userId });
    },
  );
  it("keeps the ledger locked until server validation, without a password request", async () => {
    const f = fixture(),
      manager = f.make(),
      pending = deferred<Response>();
    f.handle(async () => pending.promise);
    const restoring = manager.restore();
    await vi.waitFor(() => expect(f.requests.length).toBe(1));
    expect(manager.snapshot().status).not.toBe("ready");
    pending.resolve(json(initial.session));
    await restoring;
    expect(manager.snapshot()).toEqual({ status: "ready", userId });
    expect(f.requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/api/native/auth/session",
    ]);
    expect(f.requests[0]!.headers.get("authorization")).toBe(
      `Bearer ${initial.sessionToken}`,
    );
    expect(JSON.stringify(manager.snapshot())).not.toContain(
      initial.sessionToken,
    );
  });
  it("restores again in a fresh manager instead of revoking a valid stored session", async () => {
    const f = fixture();
    await f.make().restore();
    const restarted = f.make();
    await restarted.restore();
    expect(restarted.snapshot()).toEqual({ status: "ready", userId });
    expect(await restarted.transactions()).toEqual({
      items: [],
      nextCursor: null,
    });
  });
  it("preserves the credential offline but returns no ledger until retry succeeds", async () => {
    const f = fixture(),
      manager = f.make();
    f.handle(async () => {
      throw new TypeError("offline");
    });
    await manager.restore();
    expect(manager.snapshot().status).toBe("unavailable");
    expect(f.values.get(SESSION_KEY)).toContain(initial.sessionToken);
    await expect(manager.transactions()).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    f.handle(async () => json(initial.session));
    await manager.revalidate();
    expect(manager.snapshot()).toEqual({ status: "ready", userId });
  });
  it.each(["AUTH_SESSION_EXPIRED", "AUTH_INVALID_CREDENTIALS"] as const)(
    "clears server-rejected %s on restart",
    async (code) => {
      const f = fixture(),
        manager = f.make();
      f.handle(async () =>
        json(buildApiError({ code, retryable: false }), 401),
      );
      await manager.restore();
      expect(f.requests).toHaveLength(1);
      expect(manager.snapshot().status).toBe("signed_out");
      expect(f.values.has(SESSION_KEY)).toBe(false);
    },
  );
  it.each(["userId", "deviceId"] as const)(
    "rejects a server %s mismatch",
    async (field) => {
      const f = fixture(),
        manager = f.make();
      f.handle(async () => json({ ...initial.session, [field]: otherId }));
      await manager.restore();
      expect(manager.snapshot().status).toBe("signed_out");
      expect(f.values.has(SESSION_KEY)).toBe(false);
    },
  );
  it.each([
    "{broken",
    JSON.stringify({ signedOut: true }),
    JSON.stringify({ origin: "https://other.example", ...initial }),
    JSON.stringify({
      origin,
      ...initial,
      session: { ...initial.session, deviceId: otherId },
    }),
  ])(
    "never transmits an invalid, signed-out or foreign binding",
    async (raw) => {
      const f = fixture(),
        manager = f.make();
      f.values.set(SESSION_KEY, raw);
      await manager.restore();
      expect(manager.snapshot().status).toBe("signed_out");
      expect(f.requests).toEqual([]);
    },
  );
  it("does not reuse a credential when the installation key was removed", async () => {
    const f = fixture();
    f.values.delete(DEVICE_KEY);
    const manager = f.make();
    await manager.restore();
    expect(manager.snapshot().status).toBe("signed_out");
    expect(f.requests).toEqual([]);
    expect(f.values.get(DEVICE_KEY)).toBe(otherId);
  });
  it("refreshes once, persists rotation, then uses the new token after restart", async () => {
    const f = fixture(),
      manager = f.make();
    f.handle(async (r) =>
      new URL(r.url).pathname.endsWith("/refresh")
        ? json({ ...initial, sessionToken: "B".repeat(42) + "A" })
        : json(
            buildApiError({
              code: "AUTH_SESSION_REFRESH_REQUIRED",
              retryable: false,
            }),
            401,
          ),
    );
    await manager.restore();
    expect(manager.snapshot().status).toBe("ready");
    expect(f.values.get(SESSION_KEY)).toContain("B".repeat(42));
    f.handle(async () => json(initial.session));
    const restarted = f.make();
    await restarted.restore();
    expect(restarted.snapshot().status).toBe("ready");
    expect(f.requests.at(-1)!.headers.get("authorization")).toBe(
      `Bearer ${"B".repeat(42)}A`,
    );
  });
  it("does not replay an uncertain refresh or resurrect its old token", async () => {
    const f = fixture(),
      manager = f.make();
    f.handle(async (r) => {
      if (new URL(r.url).pathname.endsWith("/refresh"))
        throw new TypeError("lost response");
      return json(
        buildApiError({
          code: "AUTH_SESSION_REFRESH_REQUIRED",
          retryable: false,
        }),
        401,
      );
    });
    await manager.restore();
    expect(f.requests).toHaveLength(2);
    expect(manager.snapshot().status).toBe("signed_out");
    expect(f.values.has(SESSION_KEY)).toBe(false);
    const restarted = f.make();
    await restarted.restore();
    expect(restarted.snapshot().status).toBe("signed_out");
    expect(f.requests).toHaveLength(2);
  });
  it("cannot open the ledger from a restore response after logout starts", async () => {
    const f = fixture(),
      manager = f.make(),
      pending = deferred<Response>();
    f.handle(async (r) =>
      new URL(r.url).pathname.endsWith("/sign-out")
        ? json({ signedOut: true })
        : pending.promise,
    );
    const restoring = manager.restore();
    await vi.waitFor(() => expect(f.requests.length).toBe(1));
    const logout = manager.signOut();
    const seen: string[] = [];
    manager.subscribe(() => seen.push(manager.snapshot().status));
    pending.resolve(json(initial.session));
    await Promise.all([restoring, logout]);
    expect(seen).not.toContain("ready");
    expect(manager.snapshot().status).toBe("signed_out");
    expect(f.values.has(SESSION_KEY)).toBe(false);
  });
  it("honors a durable logout marker after deletion and remote revocation fail", async () => {
    const f = fixture(),
      manager = f.make();
    await manager.restore();
    f.storage.remove.mockRejectedValueOnce(new Error("disk"));
    f.handle(async () => {
      throw new TypeError("offline");
    });
    await manager.signOut();
    expect(manager.snapshot().status).toBe("storage_error");
    expect(f.values.get(SESSION_KEY)).toBe('{"signedOut":true}');
    const before = f.requests.length,
      restarted = f.make();
    await restarted.restore();
    expect(restarted.snapshot().status).toBe("signed_out");
    expect(f.requests).toHaveLength(before);
  });
  it("keeps storage failure locked after rotation instead of silently enabling a new login", async () => {
    const f = fixture(),
      manager = f.make();
    f.storage.set.mockRejectedValueOnce(new Error("disk"));
    f.handle(async (r) => {
      const path = new URL(r.url).pathname;
      if (path.endsWith("/refresh"))
        return json({ ...initial, sessionToken: "B".repeat(42) + "A" });
      if (path.endsWith("/sign-out")) return json({ signedOut: true });
      return json(
        buildApiError({
          code: "AUTH_SESSION_REFRESH_REQUIRED",
          retryable: false,
        }),
        401,
      );
    });
    await manager.restore();
    expect(manager.snapshot().status).toBe("storage_error");
    expect(f.values.has(SESSION_KEY)).toBe(false);
    expect(f.requests.at(-1)!.headers.get("authorization")).toBe(
      `Bearer ${"B".repeat(42)}A`,
    );
    await expect(
      manager.signIn("other@example.test", "password-password"),
    ).rejects.toMatchObject({ code: "STORAGE" });
  });
  it("holds the foreground lock while an earlier request rotates its token", async () => {
    const f = fixture(),
      manager = f.make();
    await manager.restore();
    const refresh = deferred<Response>(),
      validation = deferred<Response>();
    f.handle(async (r) => {
      const path = new URL(r.url).pathname;
      if (path.endsWith("/transactions"))
        return json(
          buildApiError({
            code: "AUTH_SESSION_REFRESH_REQUIRED",
            retryable: false,
          }),
          401,
        );
      if (path.endsWith("/refresh")) return refresh.promise;
      return validation.promise;
    });
    const read = manager.transactions();
    const rejected = expect(read).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    await vi.waitFor(() =>
      expect(f.requests.some((r) => r.url.endsWith("/refresh"))).toBe(true),
    );
    const verifying = manager.revalidate();
    expect(manager.snapshot().status).toBe("verifying");
    const seen: string[] = [];
    manager.subscribe(() => seen.push(manager.snapshot().status));
    refresh.resolve(json({ ...initial, sessionToken: "B".repeat(42) + "A" }));
    await rejected;
    expect(manager.snapshot().status).toBe("verifying");
    expect(seen).not.toContain("ready");
    validation.resolve(json(initial.session));
    await verifying;
    expect(manager.snapshot().status).toBe("ready");
  });
});
