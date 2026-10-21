import { describe, expect, it, vi } from "vitest";
import { NotificationAccess } from "./notification-access";

function fixture() {
  let scope: {
    origin: string;
    userId: string;
    deviceId: string;
    generation: number;
  } | null = {
    origin: "https://ledger.example",
    userId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    generation: 1,
  };
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
  const native = {
    getStatus: vi.fn(async () => ({
      available: true,
      accessGranted: false,
      listenerConnected: false,
    })),
    openSettings: vi.fn(async () => true),
  };
  const model = new NotificationAccess(() => scope, storage, native);
  return {
    model,
    storage,
    native,
    logout: () => {
      scope = null;
    },
    relogin: () => {
      if (scope) scope = { ...scope, generation: scope.generation + 1 };
    },
  };
}
describe("notification consent and permission state", () => {
  it("blocks settings before consent; saving does not imply OS grant", async () => {
    const f = fixture();
    await f.model.start();
    await f.model.openSettings();
    expect(f.native.openSettings).not.toHaveBeenCalled();
    await f.model.accept();
    expect(f.model.snapshot().consent).not.toBeNull();
    expect(f.model.snapshot().permission?.accessGranted).toBe(false);
    await f.model.openSettings();
    expect(f.native.openSettings).toHaveBeenCalledTimes(1);
    expect(f.model.snapshot().permission?.accessGranted).toBe(false);
  });
  it("shows preexisting OS grant separately and permits its removal settings without consent", async () => {
    const f = fixture();
    f.native.getStatus.mockResolvedValue({
      available: true,
      accessGranted: true,
      listenerConnected: true,
    });
    await f.model.start();
    expect(f.model.snapshot().consent).toBeNull();
    await f.model.openSettings();
    expect(f.native.openSettings).toHaveBeenCalledTimes(1);
  });
  it("withdraws local consent but does not pretend to revoke OS access", async () => {
    const f = fixture();
    f.native.getStatus.mockResolvedValue({
      available: true,
      accessGranted: true,
      listenerConnected: true,
    });
    await f.model.start();
    await f.model.accept();
    await f.model.withdraw();
    expect(f.model.snapshot().consent).toBeNull();
    expect(f.model.snapshot().permission?.accessGranted).toBe(true);
  });
  it("fails closed on storage failure and prevents settings", async () => {
    const f = fixture();
    await f.model.start();
    f.storage.set = async () => {
      throw new Error("private");
    };
    await f.model.accept();
    expect(f.model.snapshot().phase).toBe("error");
    expect(f.model.snapshot().consent).toBeNull();
    await f.model.openSettings();
    expect(f.native.openSettings).not.toHaveBeenCalled();
    expect(JSON.stringify(f.model.snapshot())).not.toContain("private");
  });
  it.each(["stop", "logout", "relogin"])(
    "drops late writes after %s without opening OS settings",
    async (action) => {
      const f = fixture();
      await f.model.start();
      let finish!: () => void;
      const set = f.storage.set;
      f.storage.set = async (key, value) => {
        await new Promise<void>((r) => {
          finish = r;
        });
        await set(key, value);
      };
      const pending = f.model.accept();
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      if (action === "stop") f.model.stop();
      else if (action === "logout") f.logout();
      else f.relogin();
      finish();
      await pending;
      expect(f.model.snapshot().consent).toBeNull();
      expect(f.native.openSettings).not.toHaveBeenCalled();
    },
  );
  it("blocks repeated writes and surfaces unavailable settings without granting permission", async () => {
    const f = fixture();
    await f.model.start();
    const writes = vi.spyOn(f.storage, "set");
    await Promise.all([f.model.accept(), f.model.accept()]);
    expect(writes).toHaveBeenCalledTimes(1);
    f.native.openSettings.mockResolvedValue(false);
    await f.model.openSettings();
    expect(f.model.snapshot().notice).toContain("열지 못");
    expect(f.model.snapshot().permission?.accessGranted).toBe(false);
  });
  it("does not claim an old APK supports permissions", async () => {
    const f = fixture();
    f.native.getStatus.mockResolvedValue({
      available: false,
      accessGranted: false,
      listenerConnected: false,
    });
    await f.model.start();
    await f.model.accept();
    await f.model.openSettings();
    expect(f.native.openSettings).not.toHaveBeenCalled();
    expect(f.model.snapshot().permission?.available).toBe(false);
  });
  it("does not report a failed withdrawal as complete, and rereads the stored state", async () => {
    const f = fixture();
    await f.model.start();
    await f.model.accept();
    f.storage.remove = async () => {
      throw new Error("private");
    };
    await f.model.withdraw();
    expect(f.model.snapshot().phase).toBe("error");
    expect(f.model.snapshot().notice).toContain("완료되지 않았을");
    await f.model.reload();
    expect(f.model.snapshot().consent).not.toBeNull();
  });
});
