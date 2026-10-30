import { describe, expect, it, vi } from "vitest";
import {
  SessionManager,
  SESSION_KEY,
  DEVICE_KEY,
  type SessionStorage,
} from "./session-manager";
import { ClientError } from "../api/client-error";
import { NativeLedgerClient } from "../api/native-ledger-client";
import { NativeCollectorClient } from "../api/native-collector-client";

const deviceId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";
const response = {
  sessionToken: "A".repeat(43),
  session: {
    authenticated: true as const,
    userId,
    deviceId,
    refreshAt: "2030-01-01T00:00:00.000Z",
  },
};
function fixture() {
  const values = new Map<string, string>();
  const storage: SessionStorage = {
    get: vi.fn(async (key) => values.get(key) ?? null),
    set: vi.fn(async (key, value) => {
      values.set(key, value);
    }),
    remove: vi.fn(async (key) => {
      values.delete(key);
    }),
  };
  const client = {
    collector: new NativeCollectorClient(async () => {
      throw new Error("Unused collector test transport");
    }),
    ledger: new NativeLedgerClient(async () => {
      throw new Error("Unused ledger test transport");
    }),
    origin: "https://ledger.example",
    signIn: vi.fn(async () => response),
    session: vi.fn(async () => response.session),
    refresh: vi.fn(async () => ({
      ...response,
      sessionToken: "B".repeat(42) + "A",
    })),
    signOut: vi.fn(async () => undefined),
    transactions: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
  const manager = new SessionManager(client, storage, () => deviceId);
  return { manager, client, storage, values };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

describe("secure native session lifecycle", () => {
  it("blocks the ledger when foreground validation fails", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    f.client.session.mockRejectedValueOnce(new ClientError("NETWORK"));
    await expect(f.manager.revalidate()).rejects.toMatchObject({
      code: "NETWORK",
    });
    expect(f.manager.snapshot().status).toBe("unavailable");
    await expect(f.manager.transactions()).rejects.toThrow();
    await f.manager.revalidate();
    expect(f.manager.snapshot().status).toBe("ready");
  });
  it("only the latest foreground check can unlock the ledger", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    const first = deferred<typeof response.session>();
    const second = deferred<typeof response.session>();
    f.client.session
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const a = f.manager.revalidate();
    const b = f.manager.revalidate();
    expect(f.manager.snapshot().status).toBe("verifying");
    first.resolve(response.session);
    await a;
    expect(f.manager.snapshot().status).toBe("verifying");
    second.resolve(response.session);
    await b;
    expect(f.manager.snapshot().status).toBe("ready");
  });
  it("does not clear a rotated credential on a late old-token 401", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    const pending = deferred<{ items: never[]; nextCursor: null }>();
    f.client.transactions.mockReturnValueOnce(pending.promise);
    const read = f.manager.transactions();
    const checked = expect(read).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    await vi.waitFor(() =>
      expect(f.client.transactions).toHaveBeenCalledTimes(1),
    );
    f.client.session.mockRejectedValueOnce(
      new ClientError("AUTH_SESSION_REFRESH_REQUIRED", 401),
    );
    await f.manager.revalidate();
    pending.reject(new ClientError("AUTH_SESSION_EXPIRED", 401));
    await checked;
    expect(f.manager.snapshot().status).toBe("ready");
    expect(f.values.get(SESSION_KEY)).toContain("B".repeat(42));
  });
  it("refreshes a current-token refresh-required response without replaying the list", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    f.client.transactions.mockRejectedValueOnce(
      new ClientError("AUTH_SESSION_REFRESH_REQUIRED", 401),
    );
    await expect(f.manager.transactions()).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    expect(f.client.refresh).toHaveBeenCalledTimes(1);
    expect(f.client.transactions).toHaveBeenCalledTimes(1);
    expect(f.manager.snapshot().status).toBe("ready");
  });
  it("does not claim logout completion when both durable cleanup and remote revocation fail", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    vi.mocked(f.storage.set).mockRejectedValueOnce(new Error("disk"));
    vi.mocked(f.storage.remove).mockRejectedValueOnce(new Error("disk"));
    f.client.signOut.mockRejectedValueOnce(new ClientError("NETWORK"));
    await f.manager.signOut();
    expect(f.manager.snapshot().status).toBe("storage_error");
    expect(f.values.get(SESSION_KEY)).toContain(response.sessionToken);
    await expect(
      f.manager.signIn("other@b.co", "password-password"),
    ).rejects.toMatchObject({ code: "STORAGE" });
    // 모든 I/O 실패 때는 로그아웃 의도를 영속화할 수 없다. 정리 확인 전 성공으로 표시하지 않는다.
    await f.manager.signOut();
    expect(f.manager.snapshot().status).toBe("signed_out");
    const restarted = new SessionManager(f.client, f.storage, () => deviceId);
    await restarted.restore();
    expect(restarted.snapshot().status).toBe("signed_out");
    expect(f.client.session).not.toHaveBeenCalled();
  });
  it("retries pending server revocation after failed cleanup", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    vi.mocked(f.storage.remove).mockRejectedValueOnce(new Error("disk"));
    f.client.signOut.mockRejectedValueOnce(new ClientError("NETWORK"));
    await f.manager.signOut();
    await f.manager.signOut();
    expect(f.client.signOut).toHaveBeenCalledTimes(2);
  });
  it("starts signed out and reuses a secure installation UUID", async () => {
    const f = fixture();
    await f.manager.restore();
    expect(f.manager.snapshot().status).toBe("signed_out");
    expect(f.values.get(DEVICE_KEY)).toBe(deviceId);
  });
  it("persists only origin-bound opaque session metadata", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("test@example.com", "temporary-password");
    const saved = f.values.get(SESSION_KEY)!;
    expect(saved).toContain(f.client.origin);
    expect(saved).not.toContain("password");
    expect(saved).not.toContain("test@example.com");
    expect(f.manager.snapshot()).toEqual({ status: "ready", userId });
    expect(JSON.stringify(f.manager.snapshot())).not.toContain(
      response.sessionToken,
    );
  });
  it("refuses storage read failure instead of opening login", async () => {
    const f = fixture();
    vi.mocked(f.storage.get).mockRejectedValueOnce(new Error("disk"));
    await f.manager.restore();
    expect(f.manager.snapshot().status).toBe("storage_error");
    await expect(
      f.manager.signIn("a@b.co", "password-password"),
    ).rejects.toMatchObject({ code: "STORAGE" });
  });
  it("does not restore a token for a different server", async () => {
    const f = fixture();
    f.values.set(
      SESSION_KEY,
      JSON.stringify({ origin: "https://other.example", ...response }),
    );
    await f.manager.restore();
    expect(f.client.session).not.toHaveBeenCalled();
    expect(f.values.has(SESSION_KEY)).toBe(false);
    expect(f.manager.snapshot().status).toBe("signed_out");
  });
  it("requires same installation for restored token", async () => {
    const f = fixture();
    f.values.set(DEVICE_KEY, deviceId);
    f.values.set(
      SESSION_KEY,
      JSON.stringify({
        origin: f.client.origin,
        ...response,
        session: { ...response.session, deviceId: userId },
      }),
    );
    await f.manager.restore();
    expect(f.client.session).not.toHaveBeenCalled();
    expect(f.manager.snapshot().status).toBe("signed_out");
  });
  it("does not authenticate after secure write fails", async () => {
    const f = fixture();
    await f.manager.restore();
    vi.mocked(f.storage.set).mockRejectedValueOnce(new Error("disk"));
    await expect(
      f.manager.signIn("test@example.com", "password-password"),
    ).rejects.toMatchObject({ code: "STORAGE" });
    expect(f.manager.snapshot().status).not.toBe("ready");
    expect(f.client.signOut).toHaveBeenCalledWith(response.sessionToken);
  });
  it("logout immediately hides data and rejects an outstanding list", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    const pending = deferred<{ items: never[]; nextCursor: null }>();
    f.client.transactions.mockReturnValueOnce(pending.promise);
    const read = f.manager.transactions();
    await Promise.resolve();
    await Promise.resolve();
    const logout = f.manager.signOut();
    expect(f.manager.snapshot().status).not.toBe("ready");
    pending.resolve({ items: [], nextCursor: null });
    await expect(read).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    await logout;
    expect(f.values.has(SESSION_KEY)).toBe(false);
  });
  it("deletion failure blocks new login until cleanup retry succeeds", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    vi.mocked(f.storage.remove).mockRejectedValueOnce(new Error("disk"));
    await f.manager.signOut();
    expect(f.manager.snapshot().status).toBe("storage_error");
    await expect(
      f.manager.signIn("other@b.co", "password-password"),
    ).rejects.toMatchObject({ code: "STORAGE" });
    await f.manager.signOut();
    expect(f.manager.snapshot().status).toBe("signed_out");
  });
  it("serializes simultaneous refresh requirements", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    f.client.session.mockRejectedValueOnce(
      new ClientError("AUTH_SESSION_REFRESH_REQUIRED", 401),
    );
    await Promise.all([f.manager.revalidate(), f.manager.revalidate()]);
    expect(f.client.refresh).toHaveBeenCalledTimes(1);
  });
  it("uncertain refresh discards token and requests login", async () => {
    const f = fixture();
    await f.manager.restore();
    await f.manager.signIn("a@b.co", "password-password");
    f.client.session.mockRejectedValueOnce(
      new ClientError("AUTH_SESSION_REFRESH_REQUIRED", 401),
    );
    f.client.refresh.mockRejectedValueOnce(new ClientError("NETWORK"));
    await expect(f.manager.revalidate()).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    expect(f.values.has(SESSION_KEY)).toBe(false);
    expect(f.manager.snapshot().status).toBe("signed_out");
  });
  it("cannot publish a login result after logout began", async () => {
    const f = fixture();
    await f.manager.restore();
    const pending = deferred<typeof response>();
    f.client.signIn.mockReturnValueOnce(pending.promise);
    const login = f.manager.signIn("a@b.co", "password-password");
    await Promise.resolve();
    const logout = f.manager.signOut();
    pending.resolve(response);
    await expect(login).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    await logout;
    expect(f.manager.snapshot().status).toBe("signed_out");
    expect(f.values.has(SESSION_KEY)).toBe(false);
  });
});
