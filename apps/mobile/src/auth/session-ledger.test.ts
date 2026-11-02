import { describe, expect, it } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { NativeClient } from "../api/native-client";
import { SessionManager } from "./session-manager";

const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const stamp = "2026-10-16T06:53:00.000Z";
const input = {
  type: "income" as const,
  amountKrw: 1000,
  occurredOn: "2026-10-16",
  idempotencyKey: deviceId,
};
const profile = {
  id: userId,
  nickname: null,
  avatarObjectKey: null,
  signupProvider: "email",
  role: "member",
  ledgerTimeZone: "Asia/Seoul",
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
const transaction = {
  id: userId,
  kind: "income",
  amountKrw: 1000,
  occurredOn: "2026-10-16",
  accountId: null,
  categoryId: null,
  counterpartyName: null,
  transferId: null,
  memo: null,
  version: 1,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function fixture() {
  const values = new Map<string, string>();
  const paths: string[] = [];
  let handler: (request: Request) => Promise<Response> = async (request) =>
    json(
      request.url.endsWith("profile")
        ? profile
        : request.method === "POST"
          ? transaction
          : { items: [] },
    );
  const auth = {
    sessionToken: "A".repeat(43),
    session: {
      authenticated: true,
      userId,
      deviceId,
      refreshAt: "2099-01-01T00:00:00.000Z",
    },
  };
  const client = new NativeClient("https://ledger.example", async (raw) => {
    const request = new Request(raw),
      path = new URL(request.url).pathname;
    paths.push(path);
    if (path.endsWith("auth/sign-in")) return json(auth);
    if (path.endsWith("auth/sign-out")) return json({ signedOut: true });
    if (path.endsWith("session/refresh")) {
      auth.sessionToken = "B".repeat(42) + "A";
      return json(auth);
    }
    if (path.endsWith("auth/session")) return json(auth.session);
    return handler(request);
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
    paths,
    setHandler(value: typeof handler) {
      handler = value;
    },
    async login() {
      await manager.restore();
      await manager.signIn("a@example.test", "password-password");
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("session-owned ledger access", () => {
  it("blocks writes and reference reads before login", async () => {
    const f = fixture();
    await f.manager.restore();
    await expect(f.manager.createTransaction(input)).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    await expect(f.manager.accounts()).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    expect(f.paths).toEqual([]);
  });
  it("loads own profile and optional references and creates a transaction", async () => {
    const f = fixture();
    await f.login();
    expect((await f.manager.profile()).id).toBe(userId);
    expect((await f.manager.accounts()).items).toEqual([]);
    expect((await f.manager.categories()).items).toEqual([]);
    expect((await f.manager.createTransaction(input)).amountKrw).toBe(1000);
    expect(
      (
        await f.manager.updateProfile({
          ledgerTimeZone: "Asia/Seoul",
          expectedVersion: 1,
        })
      ).version,
    ).toBe(1);
  });
  it("rejects a foreign profile even when the HTTP schema is valid", async () => {
    const f = fixture();
    await f.login();
    f.setHandler(async () => json({ ...profile, id: deviceId }));
    await expect(f.manager.profile()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(
      f.manager.updateProfile({
        ledgerTimeZone: "Asia/Seoul",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("does not return a saved response after logout or send it for a later account", async () => {
    const f = fixture();
    await f.login();
    const started = deferred<void>(),
      response = deferred<Response>();
    f.setHandler(async () => {
      started.resolve();
      return response.promise;
    });
    const write = f.manager.createTransaction(input);
    const checked = expect(write).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    await started.promise;
    await f.manager.signOut();
    response.resolve(json(transaction));
    await checked;
    expect(f.manager.snapshot().status).toBe("signed_out");
    expect(
      f.paths.filter((path) => path.endsWith("transactions")),
    ).toHaveLength(1);
  });
  it("expires the current session on a write 401", async () => {
    const f = fixture();
    await f.login();
    f.setHandler(async () =>
      json(
        buildApiError({ code: "AUTH_SESSION_EXPIRED", retryable: false }),
        401,
      ),
    );
    await expect(f.manager.createTransaction(input)).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    expect(f.manager.snapshot().status).toBe("signed_out");
  });
  it("does not return pre-background results after foreground verification", async () => {
    const f = fixture();
    await f.login();
    const started = deferred<void>(),
      response = deferred<Response>();
    f.setHandler(async () => {
      started.resolve();
      return response.promise;
    });
    const write = f.manager.createTransaction(input);
    const checked = expect(write).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    await started.promise;
    await f.manager.revalidate();
    response.resolve(json(transaction));
    await checked;
    expect(f.manager.snapshot().status).toBe("ready");
  });
  it("rotates but never replays a write when the server asks for refresh", async () => {
    const f = fixture();
    await f.login();
    f.setHandler(async () =>
      json(
        buildApiError({
          code: "AUTH_SESSION_REFRESH_REQUIRED",
          retryable: false,
        }),
        401,
      ),
    );
    await expect(f.manager.createTransaction(input)).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    expect(f.manager.snapshot().status).toBe("ready");
    expect(
      f.paths.filter((path) => path.endsWith("transactions")),
    ).toHaveLength(1);
    expect(
      f.paths.filter((path) => path.endsWith("session/refresh")),
    ).toHaveLength(1);
  });
});
