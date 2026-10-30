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
const state = {
  version: 1,
  state: "granted",
  noticeVersion: "notification-access-v1",
};
const input = { action: "withdraw" as const, expectedVersion: 1 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function fixture() {
  const values = new Map<string, string>(),
    requests: Request[] = [];
  let handle = async () => json(state);
  const manager = new SessionManager(
    new NativeClient("https://ledger.example", async (raw) => {
      const request = new Request(raw);
      requests.push(request);
      if (request.url.endsWith("/sign-in")) return json(auth);
      if (request.url.endsWith("/sign-out")) return json({ signedOut: true });
      if (request.url.endsWith("/session")) return json(auth.session);
      if (request.url.endsWith("/refresh"))
        return json({ ...auth, sessionToken: "B".repeat(42) + "A" });
      return handle();
    }),
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
describe("session-owned server consent", () => {
  it("requires verified login and keeps credentials out of public state", async () => {
    const f = fixture();
    await f.manager.restore();
    await expect(f.manager.notificationConsent()).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    await expect(
      f.manager.changeNotificationConsent(input),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(f.requests).toEqual([]);
    await f.manager.signIn("a@example.test", "password-password");
    expect(await f.manager.notificationConsent()).toEqual(state);
    expect(await f.manager.changeNotificationConsent(input)).toEqual(state);
    expect(JSON.stringify(f.manager.snapshot())).not.toContain(
      auth.sessionToken,
    );
  });
  it.each(["logout", "foreground"])(
    "discards a late consent response after %s",
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
      const pending = f.manager.changeNotificationConsent(input);
      const checked = expect(pending).rejects.toMatchObject({
        code: "SESSION_CHANGED",
      });
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      if (action === "logout") await f.manager.signOut();
      else await f.manager.revalidate();
      finish(json(state));
      await checked;
    },
  );
  it("clears a revoked session", async () => {
    const f = fixture();
    await f.login();
    f.handle(async () =>
      json(
        buildApiError({ code: "AUTH_SESSION_EXPIRED", retryable: false }),
        401,
      ),
    );
    await expect(f.manager.notificationConsent()).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    expect(f.manager.snapshot().status).toBe("signed_out");
  });
  it("refreshes authentication without replaying the consent mutation", async () => {
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
    await expect(
      f.manager.changeNotificationConsent(input),
    ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(
      f.requests.filter((r) => r.url.endsWith("/collector/consent")),
    ).toHaveLength(1);
    expect(f.requests.filter((r) => r.url.endsWith("/refresh"))).toHaveLength(
      1,
    );
  });
});
