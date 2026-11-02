import { describe, expect, it, vi } from "vitest";
import type {
  CollectorState,
  NotificationConsentState,
} from "@account-book/contracts";
import { CollectorEnrollment } from "./collector-enrollment";
import type { AccessScope } from "./notification-access";

function fixture(initial: CollectorState["state"] = "inactive", os = true) {
  let scope: AccessScope | null = {
    origin: "https://example.test",
    userId: "user-a",
    deviceId: "install-a",
    generation: 1,
  };
  let permission = os;
  let collector: CollectorState = { state: initial, version: 2 };
  let consent: NotificationConsentState = {
    state: "not_granted",
    version: 0,
    noticeVersion: "notification-access-v1",
  };
  const api = {
    collectorState: vi.fn(async () => collector),
    changeCollector: vi.fn(
      async (input: { action: string; expectedVersion: number }) => {
        collector = {
          state: input.action === "activate" ? "active_here" : "inactive",
          version: input.expectedVersion + 1,
        };
        return collector;
      },
    ),
    notificationConsent: vi.fn(async () => consent),
    changeNotificationConsent: vi.fn(
      async (input: { action: string; expectedVersion: number }) => {
        consent = {
          state: input.action === "accept" ? "granted" : "withdrawn",
          version: input.expectedVersion + 1,
          noticeVersion: "notification-access-v1",
        };
        return consent;
      },
    ),
  };
  const native = {
    getStatus: vi.fn(async () => ({
      available: true,
      accessGranted: permission,
      listenerConnected: permission,
    })),
    openSettings: vi.fn(async () => true),
  };
  const model = new CollectorEnrollment(() => scope, api, native);
  return {
    api,
    native,
    model,
    setOs: (v: boolean) => {
      permission = v;
    },
    setScope: (v: AccessScope | null) => {
      scope = v;
    },
    getScope: () => scope!,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("independent permission and collector controls", () => {
  it.each(["inactive", "active_elsewhere", "active_here"] as const)(
    "only saves the %s change after the prepared dialog confirms",
    async (initial) => {
      const f = fixture(initial);
      await f.model.start();
      await f.model.requestAccess();
      const action = initial === "active_here" ? "deactivate" : "activate";
      const dialog = f.model.prepareCollectorChange(action)!;
      expect(dialog).not.toBeNull();
      expect(f.model.prepareCollectorChange(action)).toBeNull();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
      await dialog.confirm();
      await dialog.confirm();
      dialog.cancel();
      expect(f.api.changeCollector).toHaveBeenCalledExactlyOnceWith(
        action === "deactivate"
          ? { action: "deactivate", expectedVersion: 2 }
          : {
              action: "activate",
              expectedVersion: 2,
              replaceExisting: initial === "active_elsewhere",
            },
      );
      expect(f.model.settings.snapshot().value?.state).toBe(
        initial === "active_here" ? "inactive" : "active_here",
      );
      f.model.stop();
    },
  );
  it("cancels a dialog without saving and isolates its callbacks from a new dialog", async () => {
    const f = fixture();
    await f.model.start();
    await f.model.requestAccess();
    const old = f.model.prepareCollectorChange("activate")!;
    old.cancel();
    expect(f.model.settings.snapshot().confirmation).toBeNull();
    await old.confirm();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    const next = f.model.prepareCollectorChange("activate")!;
    old.cancel();
    await old.confirm();
    expect(f.model.settings.snapshot().confirmation).toEqual(next.confirmation);
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    await next.confirm();
    expect(f.model.settings.snapshot().value?.state).toBe("active_here");
    f.model.stop();
  });
  it.each([
    "origin",
    "userId",
    "deviceId",
    "generation",
    "restart",
    "reload",
  ] as const)(
    "rejects a prepared collector dialog after %s changes",
    async (change) => {
      const f = fixture();
      await f.model.start();
      await f.model.requestAccess();
      const old = f.model.prepareCollectorChange("activate")!;
      if (change === "restart") {
        f.model.stop();
        await f.model.start();
      } else if (change === "reload") await f.model.reload();
      else
        f.setScope({
          ...f.getScope(),
          [change]: change === "generation" ? 2 : "different",
        });
      await old.confirm();
      old.cancel();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
      if (change === "restart" || change === "reload") {
        const next = f.model.prepareCollectorChange("activate")!;
        old.cancel();
        await old.confirm();
        expect(f.model.settings.snapshot().confirmation).toEqual(
          next.confirmation,
        );
        await next.confirm();
        expect(f.api.changeCollector).toHaveBeenCalledOnce();
      } else {
        expect(f.model.prepareCollectorChange("activate")).toBeNull();
      }
      f.model.stop();
    },
  );
  it("grants consent without enrolling, including repeated requests and reload", async () => {
    const f = fixture();
    await f.model.start();
    await f.model.requestAccess();
    await f.model.requestAccess();
    await f.model.reload();
    expect(f.model.access.snapshot().consent?.state).toBe("granted");
    expect(f.model.settings.snapshot().value?.state).toBe("inactive");
    expect(f.api.changeNotificationConsent).toHaveBeenCalledTimes(1);
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    expect(f.native.openSettings).not.toHaveBeenCalled();
  });
  it.each(["inactive", "active_elsewhere", "active_here"] as const)(
    "never changes %s designation after permission settings return",
    async (initial) => {
      const f = fixture(initial, false);
      await f.model.start();
      await f.model.requestAccess();
      expect(f.native.openSettings).toHaveBeenCalledOnce();
      f.model.stop();
      f.setOs(true);
      await f.model.start();
      expect(f.model.access.snapshot().permission?.accessGranted).toBe(true);
      expect(f.model.settings.snapshot().value?.state).toBe(initial);
      expect(f.api.changeCollector).not.toHaveBeenCalled();
      expect(f.model.settings.snapshot().confirmation).toBeNull();
    },
  );
  it("allows permission setup when collector status is unavailable", async () => {
    const f = fixture();
    f.api.collectorState.mockRejectedValue(new Error("offline"));
    await f.model.start();
    await f.model.requestAccess();
    expect(f.model.access.snapshot().consent?.state).toBe("granted");
    expect(f.api.changeCollector).not.toHaveBeenCalled();
  });
  it.each(["inactive", "active_elsewhere"] as const)(
    "designates %s only through separate explicit confirmation",
    async (initial) => {
      const f = fixture(initial);
      await f.model.start();
      await f.model.requestAccess();
      f.model.settings.choose("activate");
      expect(f.api.changeCollector).not.toHaveBeenCalled();
      f.model.cancel();
      await f.model.confirm();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
      f.model.settings.choose("activate");
      await f.model.confirm();
      expect(f.api.changeCollector).toHaveBeenCalledExactlyOnceWith({
        action: "activate",
        expectedVersion: 2,
        replaceExisting: initial === "active_elsewhere",
      });
      expect(f.model.settings.snapshot().value?.state).toBe("active_here");
      f.model.stop();
    },
  );
  it.each(["consent", "permission"] as const)(
    "blocks designation when %s is missing without auto granting",
    async (missing) => {
      const f = fixture("inactive", missing !== "permission");
      await f.model.start();
      if (missing === "permission") await f.model.access.accept();
      f.model.settings.choose("activate");
      await f.model.confirm();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
      expect(f.native.openSettings).not.toHaveBeenCalled();
      expect(f.model.settings.snapshot().confirmation).toBeNull();
    },
  );
  it("rechecks permission before replacement and preserves previous collector on denial", async () => {
    const f = fixture("active_elsewhere");
    await f.model.start();
    await f.model.requestAccess();
    f.model.settings.choose("activate");
    f.setOs(false);
    await f.model.confirm();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    expect(f.model.settings.snapshot().value?.state).toBe("active_elsewhere");
  });
  it("allows deactivation without permission or consent", async () => {
    const f = fixture("active_here", false);
    await f.model.start();
    f.model.settings.choose("deactivate");
    await f.model.confirm();
    expect(f.model.settings.snapshot().value?.state).toBe("inactive");
    f.model.stop();
  });
  it("withdraws consent, opens OS settings, and preserves independent designation", async () => {
    const f = fixture("active_here");
    await f.model.start();
    await f.model.requestAccess();
    await f.model.prepareWithdrawal()();
    expect(f.model.access.snapshot().consent?.state).toBe("withdrawn");
    expect(f.model.access.snapshot().permission?.accessGranted).toBe(true);
    expect(f.native.openSettings).toHaveBeenCalledOnce();
    expect(f.model.settings.snapshot().value?.state).toBe("active_here");
    expect(f.api.changeCollector).not.toHaveBeenCalled();
  });
  it("keeps an OS exit after uncertain withdrawal without claiming success or retrying", async () => {
    const f = fixture();
    await f.model.start();
    await f.model.requestAccess();
    f.api.changeNotificationConsent.mockRejectedValueOnce(new Error("offline"));
    await f.model.prepareWithdrawal()();
    expect(f.model.access.snapshot().phase).toBe("error");
    expect(f.model.access.snapshot().consent).toBeNull();
    expect(f.native.openSettings).toHaveBeenCalledOnce();
    expect(f.api.changeNotificationConsent).toHaveBeenCalledTimes(2);
    expect(f.api.changeCollector).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "opens settings without consent or collector writes after prior withdrawal=%s",
    async (withdrawn) => {
      const f = fixture("active_here");
      await f.model.start();
      if (withdrawn) {
        await f.model.requestAccess();
        await f.model.prepareWithdrawal()();
      }
      f.api.changeNotificationConsent.mockClear();
      f.native.openSettings.mockClear();
      await f.model.prepareWithdrawal()();
      expect(f.native.openSettings).toHaveBeenCalledOnce();
      expect(f.api.changeNotificationConsent).not.toHaveBeenCalled();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
      expect(f.model.access.snapshot().consent?.state).toBe(
        withdrawn ? "withdrawn" : "not_granted",
      );
    },
  );
  it("withdraws known consent without native access", async () => {
    const f = fixture("active_here", false);
    await f.model.start();
    await f.model.access.accept();
    f.native.getStatus.mockRejectedValueOnce(new Error("native unavailable"));
    await f.model.reload();
    await f.model.prepareWithdrawal()();
    expect(f.model.access.snapshot().consent?.state).toBe("withdrawn");
    expect(f.native.openSettings).not.toHaveBeenCalled();
  });
  it.each(["userId", "deviceId", "origin", "generation"] as const)(
    "ignores stale native callbacks after %s changes",
    async (field) => {
      const f = fixture();
      await f.model.start();
      await f.model.requestAccess();
      const allow = f.model.prepareAccessRequest(),
        deny = f.model.prepareWithdrawal();
      f.model.stop();
      f.setScope({
        ...f.getScope(),
        [field]: field === "generation" ? 2 : "changed",
      });
      await f.model.start();
      await allow();
      await deny();
      expect(f.api.changeNotificationConsent).toHaveBeenCalledTimes(1);
      expect(f.native.openSettings).not.toHaveBeenCalled();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
    },
  );
  it("locks duplicate acceptance and discards late response after leaving", async () => {
    const f = fixture(),
      pending = deferred<NotificationConsentState>();
    await f.model.start();
    f.api.changeNotificationConsent.mockReturnValueOnce(pending.promise);
    const action = f.model.requestAccess();
    await f.model.requestAccess();
    f.model.stop();
    pending.resolve({
      state: "granted",
      version: 1,
      noticeVersion: "notification-access-v1",
    });
    await action;
    expect(f.api.changeNotificationConsent).toHaveBeenCalledOnce();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    expect(f.native.openSettings).not.toHaveBeenCalled();
  });
  it("does not replay uncertain collector saves after reload or screen return", async () => {
    const f = fixture();
    await f.model.start();
    await f.model.requestAccess();
    f.api.changeCollector.mockRejectedValueOnce(new Error("lost response"));
    f.model.settings.choose("activate");
    await f.model.confirm();
    await f.model.reload();
    f.model.stop();
    await f.model.start();
    expect(f.api.changeCollector).toHaveBeenCalledOnce();
  });
  it("failed permission launch never leaves a resumable designation", async () => {
    const f = fixture("inactive", false);
    await f.model.start();
    f.native.openSettings.mockResolvedValueOnce(false);
    await f.model.requestAccess();
    f.model.stop();
    f.setOs(true);
    await f.model.start();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
  });
});
