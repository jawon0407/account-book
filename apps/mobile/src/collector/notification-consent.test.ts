import { describe, expect, it } from "vitest";
import { NotificationConsentStore } from "./notification-consent";

const scope = {
  origin: "https://ledger.example",
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
};
function fixture() {
  const values = new Map<string, string>();
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
  return {
    values,
    storage,
    store: new NotificationConsentStore(storage, scope),
  };
}
describe("notification consent persistence", () => {
  it("requires an explicit write, survives a new store and withdraws without leaving consent", async () => {
    const f = fixture();
    expect(await f.store.read()).toBeNull();
    await f.store.accept("2026-10-21T00:00:00.000Z");
    expect(
      await new NotificationConsentStore(f.storage, scope).read(),
    ).toMatchObject({
      version: "notification-access-v1",
      acceptedAt: "2026-10-21T00:00:00.000Z",
    });
    await f.store.withdraw();
    expect(await f.store.read()).toBeNull();
  });
  it.each([
    { userId: "33333333-3333-4333-8333-333333333333" },
    { deviceId: "44444444-4444-4444-8444-444444444444" },
    { origin: "https://other.example" },
  ])("does not reuse consent across scope %j", async (change) => {
    const f = fixture();
    await f.store.accept("2026-10-21T00:00:00.000Z");
    expect(
      await new NotificationConsentStore(f.storage, {
        ...scope,
        ...change,
      }).read(),
    ).toBeNull();
  });
  it.each([
    "{}",
    "not-json",
    JSON.stringify({
      ...scope,
      version: "old",
      acceptedAt: "2026-10-21T00:00:00.000Z",
      state: "accepted",
    }),
  ])("rejects malformed or old consent", async (raw) => {
    const f = fixture();
    await f.store.accept("2026-10-21T00:00:00.000Z");
    for (const key of f.values.keys()) f.values.set(key, raw);
    expect(await f.store.read()).toBeNull();
  });
  it("does not report success when write or delete is silently lost", async () => {
    const f = fixture();
    f.storage.set = async () => {};
    await expect(f.store.accept("2026-10-21T00:00:00.000Z")).rejects.toThrow();
    const g = fixture();
    await g.store.accept("2026-10-21T00:00:00.000Z");
    g.storage.remove = async () => {};
    await expect(g.store.withdraw()).rejects.toThrow();
  });
  it("propagates a read failure instead of claiming no consent", async () => {
    const f = fixture();
    f.storage.get = async () => {
      throw new Error("storage");
    };
    await expect(f.store.read()).rejects.toThrow();
  });
  it("serializes a late acceptance and withdrawal across reopened screens", async () => {
    const f = fixture();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const set = f.storage.set;
    f.storage.set = async (key, value) => {
      await blocked;
      await set(key, value);
    };
    const accepting = f.store.accept("2026-10-21T00:00:00.000Z");
    const reopened = new NotificationConsentStore(f.storage, scope);
    const withdrawing = reopened.withdraw();
    release();
    await Promise.all([accepting, withdrawing]);
    expect(await reopened.read()).toBeNull();
  });
});
