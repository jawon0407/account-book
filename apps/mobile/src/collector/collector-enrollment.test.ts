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
  let time = 1000;
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
  const model = new CollectorEnrollment(
    () => scope,
    api,
    native,
    () => time,
  );
  return {
    api,
    native,
    model,
    setOs: (v: boolean) => {
      permission = v;
    },
    setCollector: (v: CollectorState) => {
      collector = v;
    },
    setScope: (v: AccessScope | null) => {
      scope = v;
    },
    getScope: () => scope!,
    setTime: (v: number) => {
      time = v;
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
describe("permission-driven collector enrollment", () => {
  it("ignores an old native confirmation after screen restart or account change", async () => {
    const f = fixture();
    await f.model.start();
    const confirm = f.model.prepareAccessRequest();
    f.model.stop();
    f.setScope({ ...f.getScope(), userId: "user-b" });
    await f.model.start();
    await confirm();
    expect(f.api.changeNotificationConsent).not.toHaveBeenCalled();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    await f.model.prepareAccessRequest()();
    expect(f.api.changeCollector).toHaveBeenCalledOnce();
  });
  it("does not resume before the native OS launch result is known", async () => {
    const f = fixture("inactive", false),
      opening = deferred<boolean>();
    await f.model.start();
    f.native.openSettings.mockImplementationOnce(async () => {
      f.model.stop();
      return opening.promise;
    });
    const request = f.model.requestAccess();
    await vi.waitFor(() =>
      expect(f.native.openSettings).toHaveBeenCalledOnce(),
    );
    f.setOs(true);
    await f.model.start();
    opening.resolve(false);
    await request;
    expect(f.api.changeCollector).not.toHaveBeenCalled();
  });
  it("never writes on entry or refresh without explicit intent", async () => {
    const f = fixture();
    await f.model.start();
    await f.model.reload();
    f.model.stop();
    await f.model.start();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    expect(f.api.changeNotificationConsent).not.toHaveBeenCalled();
  });
  it("saves consent then enrolls once when OS permission already exists", async () => {
    const f = fixture();
    await f.model.start();
    await f.model.requestAccess();
    expect(f.api.changeNotificationConsent).toHaveBeenCalledTimes(1);
    expect(f.api.changeCollector).toHaveBeenCalledExactlyOnceWith({
      action: "activate",
      expectedVersion: 2,
      replaceExisting: false,
    });
    expect(f.native.openSettings).not.toHaveBeenCalled();
    await f.model.requestAccess();
    expect(f.api.changeCollector).toHaveBeenCalledTimes(1);
    expect(f.api.changeNotificationConsent).toHaveBeenCalledTimes(1);
  });
  it("resumes only explicit OS roundtrip after a fresh permission check", async () => {
    const f = fixture("inactive", false);
    await f.model.start();
    await f.model.requestAccess();
    expect(f.native.openSettings).toHaveBeenCalledOnce();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    f.model.stop();
    f.setOs(true);
    await f.model.start();
    expect(f.api.changeCollector).toHaveBeenCalledOnce();
    f.model.stop();
    await f.model.start();
    expect(f.api.changeCollector).toHaveBeenCalledOnce();
  });
  it("denial preserves the previous collector and discards pending enrollment", async () => {
    const f = fixture("active_elsewhere", false);
    await f.model.start();
    await f.model.requestAccess();
    f.model.stop();
    await f.model.start();
    expect(f.model.settings.snapshot().confirmation).toBeNull();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    f.setOs(true);
    await f.model.reload();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
  });
  it("requires separate replacement confirmation and supports cancellation", async () => {
    const f = fixture("active_elsewhere");
    await f.model.start();
    await f.model.requestAccess();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    expect(f.model.settings.snapshot().confirmation?.action).toBe("activate");
    f.model.cancel();
    await f.model.confirm();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    await f.model.requestAccess();
    await f.model.confirm();
    expect(f.api.changeCollector).toHaveBeenCalledExactlyOnceWith({
      action: "activate",
      expectedVersion: 2,
      replaceExisting: true,
    });
  });
  it("rechecks OS access before confirmed replacement", async () => {
    const f = fixture("active_elsewhere");
    await f.model.start();
    await f.model.requestAccess();
    f.setOs(false);
    await f.model.confirm();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    expect(f.model.settings.snapshot().confirmation).toBeNull();
  });
  it("keeps deactivation possible without consent or permission", async () => {
    const f = fixture("active_elsewhere", false);
    await f.model.start();
    f.model.settings.choose("deactivate");
    await f.model.confirm();
    expect(f.api.changeCollector).toHaveBeenCalledExactlyOnceWith({
      action: "deactivate",
      expectedVersion: 2,
    });
  });
  it.each(["userId", "deviceId", "origin", "generation"] as const)(
    "discards pending intent when %s changes",
    async (field) => {
      const f = fixture("inactive", false);
      await f.model.start();
      await f.model.requestAccess();
      f.model.stop();
      f.setOs(true);
      f.setScope({
        ...f.getScope(),
        [field]: field === "generation" ? 2 : "changed",
      });
      await f.model.start();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
    },
  );
  it.each([601001, 0])(
    "discards expired or backward-clock intent at %s",
    async (time) => {
      const f = fixture("inactive", false);
      await f.model.start();
      await f.model.requestAccess();
      f.model.stop();
      f.setOs(true);
      f.setTime(time);
      await f.model.start();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
    },
  );
  it("does not silently adopt a changed collector version during OS settings", async () => {
    const f = fixture("inactive", false);
    await f.model.start();
    await f.model.requestAccess();
    f.model.stop();
    f.setOs(true);
    f.setCollector({ state: "inactive", version: 4 });
    await f.model.start();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
  });
  it("clears intent on navigation away, withdrawal, or OS launch failure", async () => {
    for (const action of ["cancel", "withdraw", "failure"] as const) {
      const f = fixture("inactive", false);
      await f.model.start();
      if (action === "failure")
        f.native.openSettings.mockResolvedValueOnce(false);
      await f.model.requestAccess();
      if (action === "cancel") f.model.cancel();
      if (action === "withdraw") await f.model.withdraw();
      f.model.stop();
      f.setOs(true);
      await f.model.start();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
    }
  });
  it("blocks settings and enrollment after uncertain consent save", async () => {
    const f = fixture();
    await f.model.start();
    f.api.changeNotificationConsent.mockRejectedValueOnce(new Error("offline"));
    await f.model.requestAccess();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
    expect(f.native.openSettings).not.toHaveBeenCalled();
  });
  it("unknown OS or consent response cannot enroll", async () => {
    const f = fixture();
    await f.model.start();
    f.native.getStatus.mockRejectedValueOnce(new Error("unavailable"));
    await f.model.requestAccess();
    expect(f.api.changeCollector).not.toHaveBeenCalled();
  });
  it("locks double taps and ignores late consent success after leaving", async () => {
    const f = fixture();
    const pending = deferred<NotificationConsentState>();
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
  });
  it("does not retry a collector write whose response was lost", async () => {
    const f = fixture();
    await f.model.start();
    f.api.changeCollector.mockRejectedValueOnce(new Error("lost response"));
    await f.model.requestAccess();
    await f.model.reload();
    f.model.stop();
    await f.model.start();
    expect(f.api.changeCollector).toHaveBeenCalledOnce();
  });
  it("preserves intent when OS launch backgrounds the screen before resolving", async () => {
    const f = fixture("inactive", false);
    await f.model.start();
    f.native.openSettings.mockImplementationOnce(async () => {
      f.model.stop();
      return true;
    });
    await f.model.requestAccess();
    f.setOs(true);
    await f.model.start();
    expect(f.api.changeCollector).toHaveBeenCalledOnce();
  });
  it.each(["false", "throw"])(
    "discards a late OS launch %s after background",
    async (failure) => {
      const f = fixture("inactive", false);
      await f.model.start();
      f.native.openSettings.mockImplementationOnce(async () => {
        f.model.stop();
        if (failure === "throw") throw new Error("unavailable");
        return false;
      });
      await f.model.requestAccess();
      f.setOs(true);
      await f.model.start();
      expect(f.api.changeCollector).not.toHaveBeenCalled();
    },
  );
});
