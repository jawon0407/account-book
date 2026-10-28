import { describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_NOTICE_VERSION,
  type NotificationConsentChangeInput,
  type NotificationConsentState,
} from "@account-book/contracts";
import { ClientError } from "../api/client-error";
import { NotificationAccess, type AccessScope } from "./notification-access";

function consent(
  state: NotificationConsentState["state"],
  version = 1,
): NotificationConsentState {
  return {
    state,
    version: state === "not_granted" ? 0 : version,
    noticeVersion: NOTIFICATION_NOTICE_VERSION,
  };
}
function fixture(initial = consent("not_granted")) {
  let scope: AccessScope | null = {
    origin: "https://ledger.example",
    userId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    generation: 1,
  };
  let stored = initial;
  const server = {
    notificationConsent: vi.fn(async () => stored),
    changeNotificationConsent: vi.fn(
      async (input: NotificationConsentChangeInput) => {
        stored = consent(
          input.action === "accept" ? "granted" : "withdrawn",
          input.expectedVersion + 1,
        );
        return stored;
      },
    ),
  };
  const native = {
    getStatus: vi.fn(async () => ({
      available: true,
      accessGranted: false,
      listenerConnected: false,
    })),
    openSettings: vi.fn(async () => true),
  };
  const model = new NotificationAccess(() => scope, server, native);
  return {
    model,
    server,
    native,
    logout: () => {
      scope = null;
    },
    relogin: () => {
      if (scope) scope = { ...scope, generation: scope.generation + 1 };
    },
  };
}

describe("server consent and independent Android permission", () => {
  it("reads server state; explicitly accepts with notice and version, without opening settings", async () => {
    const f = fixture();
    await f.model.start();
    expect(f.model.snapshot().consent).toEqual(consent("not_granted"));
    await f.model.openSettings();
    expect(f.native.openSettings).not.toHaveBeenCalled();
    await f.model.accept();
    expect(f.server.changeNotificationConsent).toHaveBeenCalledWith({
      action: "accept",
      expectedVersion: 0,
      noticeVersion: NOTIFICATION_NOTICE_VERSION,
    });
    expect(f.model.snapshot().consent).toEqual(consent("granted"));
    expect(f.native.openSettings).not.toHaveBeenCalled();
    await f.model.openSettings();
    expect(f.native.openSettings).toHaveBeenCalledTimes(1);
    expect(f.model.snapshot().permission?.accessGranted).toBe(false);
  });
  it("withdraws on the server without pretending OS access was removed", async () => {
    const f = fixture(consent("granted", 4));
    f.native.getStatus.mockResolvedValue({
      available: true,
      accessGranted: true,
      listenerConnected: true,
    });
    await f.model.start();
    await f.model.withdraw();
    expect(f.server.changeNotificationConsent).toHaveBeenCalledWith({
      action: "withdraw",
      expectedVersion: 4,
    });
    expect(f.model.snapshot().consent).toEqual(consent("withdrawn", 5));
    expect(f.model.snapshot().permission?.accessGranted).toBe(true);
  });
  it.each(["not_granted", "withdrawn", "outdated"] as const)(
    "does not use %s as permission to open disabled OS access",
    async (state) => {
      const f = fixture(consent(state));
      await f.model.start();
      await f.model.openSettings();
      expect(f.native.openSettings).not.toHaveBeenCalled();
    },
  );
  it("allows removal of an existing OS grant even if server status fails", async () => {
    const f = fixture();
    f.server.notificationConsent.mockRejectedValue(new Error("private"));
    f.native.getStatus.mockResolvedValue({
      available: true,
      accessGranted: true,
      listenerConnected: true,
    });
    await f.model.start();
    await f.model.openSettings();
    expect(f.native.openSettings).toHaveBeenCalledTimes(1);
    expect(f.model.snapshot()).toMatchObject({
      phase: "error",
      consent: null,
      permission: { accessGranted: true },
    });
    await f.model.accept();
    await f.model.withdraw();
    expect(f.server.changeNotificationConsent).not.toHaveBeenCalled();
    expect(JSON.stringify(f.model.snapshot())).not.toContain("private");
  });
  it("retains verified server consent and allows withdrawal if native status fails", async () => {
    const f = fixture(consent("granted"));
    f.native.getStatus.mockRejectedValue(new Error("native-private"));
    await f.model.start();
    expect(f.model.snapshot()).toMatchObject({
      phase: "ready",
      consent: consent("granted"),
      permission: null,
    });
    await f.model.withdraw();
    expect(f.model.snapshot().consent).toEqual(consent("withdrawn", 2));
    expect(JSON.stringify(f.model.snapshot())).not.toContain("native-private");
  });
  it.each(["accept", "withdraw"] as const)(
    "allows %s for outdated consent only after user action",
    async (action) => {
      const f = fixture(consent("outdated", 8));
      await f.model.start();
      expect(f.server.changeNotificationConsent).not.toHaveBeenCalled();
      await f.model[action]();
      expect(f.model.snapshot().consent).toEqual(
        consent(action === "accept" ? "granted" : "withdrawn", 9),
      );
    },
  );
  it.each([
    "COLLECTOR_VERSION_CONFLICT",
    "COLLECTOR_SERVICE_UNAVAILABLE",
    "NETWORK",
  ] as const)(
    "does not retry or claim withdrawal after %s; reload is read-only",
    async (code) => {
      const f = fixture(consent("granted"));
      await f.model.start();
      f.server.changeNotificationConsent.mockRejectedValue(
        new ClientError(code),
      );
      await f.model.withdraw();
      expect(f.model.snapshot()).toMatchObject({
        phase: "error",
        consent: null,
      });
      expect(f.model.snapshot().notice).toContain("철회");
      await f.model.reload();
      expect(f.server.changeNotificationConsent).toHaveBeenCalledTimes(1);
      expect(f.model.snapshot().consent?.state).toBe("granted");
      expect(f.model.snapshot().notice).toContain("남아");
    },
  );
  it("recovers a lost mutation response by GET without another write", async () => {
    const f = fixture(consent("granted"));
    await f.model.start();
    f.server.changeNotificationConsent.mockImplementation(async () => {
      f.server.notificationConsent.mockResolvedValue(consent("withdrawn", 2));
      throw new Error("lost");
    });
    await f.model.withdraw();
    await f.model.reload();
    expect(f.model.snapshot().consent).toEqual(consent("withdrawn", 2));
    expect(f.server.changeNotificationConsent).toHaveBeenCalledTimes(1);
  });
  it.each([consent("withdrawn", 1), consent("granted", 2)])(
    "rejects mismatched mutation response %j",
    async (response) => {
      const f = fixture();
      await f.model.start();
      f.server.changeNotificationConsent.mockResolvedValue(response);
      await f.model.accept();
      expect(f.model.snapshot()).toMatchObject({
        phase: "error",
        consent: null,
      });
    },
  );
  it.each(["stop", "logout", "relogin"])(
    "ignores late consent responses after %s",
    async (action) => {
      const f = fixture();
      await f.model.start();
      let finish!: (value: NotificationConsentState) => void;
      f.server.changeNotificationConsent.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = f.model.accept();
      if (action === "stop") f.model.stop();
      else if (action === "logout") f.logout();
      else f.relogin();
      finish(consent("granted"));
      await pending;
      expect(f.model.snapshot().consent).toBeNull();
      expect(f.native.openSettings).not.toHaveBeenCalled();
    },
  );
  it("blocks double tap and does not request redundant mutations", async () => {
    const f = fixture();
    await f.model.start();
    await Promise.all([f.model.accept(), f.model.accept()]);
    await f.model.accept();
    expect(f.server.changeNotificationConsent).toHaveBeenCalledTimes(1);
    await f.model.withdraw();
    await f.model.withdraw();
    expect(f.server.changeNotificationConsent).toHaveBeenCalledTimes(2);
  });
  it("does not enable consent on an old APK, but still allows server withdrawal", async () => {
    const f = fixture();
    f.native.getStatus.mockResolvedValue({
      available: false,
      accessGranted: false,
      listenerConnected: false,
    });
    await f.model.start();
    await f.model.accept();
    expect(f.server.changeNotificationConsent).not.toHaveBeenCalled();
    f.server.notificationConsent.mockResolvedValue(consent("granted"));
    await f.model.reload();
    await f.model.withdraw();
    expect(f.server.changeNotificationConsent).toHaveBeenCalledTimes(1);
  });
  it("reports settings failure without discarding verified consent", async () => {
    const f = fixture(consent("granted"));
    await f.model.start();
    f.native.openSettings.mockRejectedValue(new Error("private"));
    await f.model.openSettings();
    expect(f.model.snapshot().consent?.state).toBe("granted");
    expect(f.model.snapshot().notice).toContain("열지 못");
  });
});
