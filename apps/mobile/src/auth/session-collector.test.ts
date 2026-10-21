import { describe, expect, it, vi } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { NativeClient } from "../api/native-client";
import { SessionManager } from "./session-manager";

const deviceId = "22222222-2222-4222-8222-222222222222";
const auth = {
  sessionToken: "A".repeat(43),
  session: {
    authenticated: true,
    userId: "11111111-1111-4111-8111-111111111111",
    deviceId,
    refreshAt: "2099-01-01T00:00:00.000Z",
  },
};
const state = { version: 1, state: "active_here" };
const input = { action: "deactivate" as const, expectedVersion: 1 };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
function fixture() {
  const values = new Map<string, string>(),
    requests: Request[] = [];
  let handle = async () => json(state);
  const client = new NativeClient("https://ledger.example", async (raw) => {
    const r = new Request(raw);
    requests.push(r);
    if (r.url.endsWith("/sign-in")) return json(auth);
    if (r.url.endsWith("/sign-out")) return json({ signedOut: true });
    if (r.url.endsWith("/refresh"))
      return json({ ...auth, sessionToken: "B".repeat(42) + "A" });
    if (r.url.endsWith("/session")) return json(auth.session);
    return handle();
  });
  const manager = new SessionManager(
    client,
    {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
      },
      remove: async (key) => {
        values.delete(key);
      },
    },
    () => deviceId,
  );
  return {
    manager,
    requests,
    handle: (next: typeof handle) => {
      handle = next;
    },
    login: async () => {
      await manager.restore();
      await manager.signIn("a@example.test", "password-password");
    },
  };
}
describe("session-owned collector access", () => {
  it("exposes consent scope only while verified, with a new generation after re-login", async () => {
    const f = fixture();
    expect(f.manager.notificationConsentScope()).toBeNull();
    await f.login();
    const first = f.manager.notificationConsentScope();
    expect(first).toMatchObject({
      origin: "https://ledger.example",
      userId: auth.session.userId,
      deviceId,
    });
    await f.manager.signOut();
    expect(f.manager.notificationConsentScope()).toBeNull();
    await f.manager.signIn("a@example.test", "password-password");
    expect(f.manager.notificationConsentScope()?.generation).not.toBe(
      first?.generation,
    );
  });
  it("blocks reads and changes before login", async () => {
    const f = fixture();
    await f.manager.restore();
    await expect(f.manager.collectorState()).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    await expect(f.manager.changeCollector(input)).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    expect(f.requests).toEqual([]);
  });
  it("reads and changes through the current session without publishing tokens", async () => {
    const f = fixture();
    await f.login();
    expect(await f.manager.collectorState()).toEqual(state);
    expect(await f.manager.changeCollector(input)).toEqual(state);
    expect(JSON.stringify(f.manager.snapshot())).not.toContain(
      auth.sessionToken,
    );
  });
  it.each(["logout", "foreground"])(
    "drops a late response after %s",
    async (action) => {
      const f = fixture();
      await f.login();
      let finish!: (r: Response) => void;
      f.handle(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const request = f.manager.changeCollector(input);
      const checked = expect(request).rejects.toMatchObject({
        code: "SESSION_CHANGED",
      });
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      if (action === "logout") await f.manager.signOut();
      else await f.manager.revalidate();
      finish(json(state));
      await checked;
    },
  );
  it("expires a revoked session", async () => {
    const f = fixture();
    await f.login();
    f.handle(async () =>
      json(
        buildApiError({ code: "AUTH_SESSION_EXPIRED", retryable: false }),
        401,
      ),
    );
    await expect(f.manager.collectorState()).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    expect(f.manager.snapshot().status).toBe("signed_out");
  });
  it("rotates a refresh-required credential but never replays a change", async () => {
    const f = fixture();
    await f.login();
    f.handle(async () =>
      json(
        buildApiError({
          code: "AUTH_SESSION_REFRESH_REQUIRED",
          retryable: false,
        }),
        401,
      ),
    );
    await expect(f.manager.changeCollector(input)).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    expect(f.requests.filter((r) => r.url.endsWith("/collector"))).toHaveLength(
      1,
    );
    expect(f.requests.filter((r) => r.url.endsWith("/refresh"))).toHaveLength(
      1,
    );
    expect(f.manager.snapshot().status).toBe("ready");
  });
});
