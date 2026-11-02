import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionRuntime } from "./collection-runtime";
import type { AccessScope } from "./notification-access";

function fixture() {
  let scope: AccessScope | null = { origin: "https://example.test", userId: "a", deviceId: "b", generation: 1 };
  let epoch = 0;
  let allowed = false;
  const native = {
    begin: vi.fn(async () => ++epoch),
    beginVerification: vi.fn(async () => 1),
    renew: vi.fn(async (value: number) => { allowed = value === epoch; return allowed; }),
    stop: vi.fn(async () => { epoch++; allowed = false; }),
    snapshot: vi.fn(async () => ({ running: allowed, parsed: 0, unrecognized: 0, last: null })),
  };
  const api = {
    collectorState: vi.fn(async () => ({ state: "active_here", version: 1 })),
    notificationConsent: vi.fn(async () => ({ state: "granted", version: 1, noticeVersion: "notification-access-v1" })),
  };
  const access = { getStatus: vi.fn(async () => ({ available: true, accessGranted: true, listenerConnected: true })) };
  const model = new CollectionRuntime(() => scope, api, access, native);
  return { model, native, api, access, changeScope: () => { scope = null; }, allowed: () => allowed };
}
afterEach(() => vi.useRealTimers());
describe("explicit foreground collection preview", () => {
  it("anchors native expiry before starting server validation", async () => {
    const f = fixture(); let finish!: (ticket: number) => void;
    f.native.beginVerification.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.model.start(); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(f.api.collectorState).not.toHaveBeenCalled();
    finish(7); await pending;
    expect(f.native.renew).toHaveBeenCalledWith(1, 7);
    await f.model.stop();
  });
  it("starts only explicitly and clears native preview on stop", async () => {
    vi.useFakeTimers(); const f = fixture();
    expect(f.native.begin).not.toHaveBeenCalled();
    await f.model.start(); expect(f.model.snapshot().phase).toBe("running");
    await f.model.stop(); expect(f.allowed()).toBe(false);
    expect(f.model.snapshot().result).toBeNull();
    await vi.advanceTimersByTimeAsync(10000); expect(f.native.begin).toHaveBeenCalledTimes(1);
  });
  it.each(["collector", "consent", "permission", "listener", "invalid", "server"])("does not read with missing %s", async (kind) => {
    const f = fixture();
    if (kind === "collector") f.api.collectorState.mockResolvedValue({ state: "active_elsewhere", version: 2 });
    if (kind === "consent") f.api.notificationConsent.mockResolvedValue({ state: "withdrawn", version: 2, noticeVersion: "notification-access-v1" });
    if (kind === "permission") f.access.getStatus.mockResolvedValue({ available: true, accessGranted: false, listenerConnected: false });
    if (kind === "listener") f.access.getStatus.mockResolvedValue({ available: true, accessGranted: true, listenerConnected: false });
    if (kind === "invalid") f.api.collectorState.mockResolvedValue({ state: "active_here", version: -1 });
    if (kind === "server") f.api.collectorState.mockRejectedValue(new Error("PRIVATE"));
    await f.model.start(); expect(f.native.renew).not.toHaveBeenCalled(); expect(f.allowed()).toBe(false);
    expect(JSON.stringify(f.model.snapshot())).not.toContain("PRIVATE");
  });
  it.each(["stop", "account"])("discards pending authorization after %s", async (action) => {
    const f = fixture(); let finish!: (value: {state: string; version: number}) => void;
    f.api.collectorState.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.model.start(); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    if (action === "stop") await f.model.stop(); else f.changeScope();
    finish({state: "active_here", version: 1}); await pending;
    expect(f.native.renew).not.toHaveBeenCalled(); expect(f.model.snapshot().phase).not.toBe("running");
  });
  it("stops when a later server check fails, without automatic restart", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.model.start();
    f.api.notificationConsent.mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.allowed()).toBe(false); expect(f.model.snapshot().phase).toBe("error");
    await vi.advanceTimersByTimeAsync(20000); expect(f.native.begin).toHaveBeenCalledTimes(1);
  });
  it("times out slow validation without applying a later grant", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.api.collectorState.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({state:"active_here",version:1}), 10000)));
    const pending = f.model.start(); await vi.advanceTimersByTimeAsync(2500); await pending;
    await vi.advanceTimersByTimeAsync(10000); expect(f.native.renew).not.toHaveBeenCalled();
    expect(f.model.snapshot().phase).toBe("error");
  });
  it("fails closed if native service stopped or rejects authorization", async () => {
    const f = fixture(); f.native.renew.mockResolvedValue(false);
    await f.model.start(); expect(f.model.snapshot().phase).toBe("error");
  });
  it("does not let an earlier failed stop overwrite a new run", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.model.start();
    let reject!: (error: Error) => void;
    f.native.stop.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const stopped = f.model.stop(); await f.model.start();
    reject(new Error("old failure")); await stopped;
    expect(f.model.snapshot().phase).toBe("running");
    await f.model.stop();
  });
  it("leaves read-budget headroom during a minute of preview", async () => {
    // Regression: two polls per cycle must not consume the shared 60/minute allowance.
    vi.useFakeTimers(); const f = fixture(); await f.model.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.api.collectorState.mock.calls.length + f.api.notificationConsent.mock.calls.length).toBeLessThanOrEqual(42);
    expect(f.model.snapshot().phase).toBe("running");
    await f.model.stop();
  });
  it("retains uncertainty when validation fails and native shutdown rejects", async () => {
    // Regression: failed shutdown must not be overwritten with a confirmed-stop notice.
    vi.useFakeTimers(); const f = fixture(); await f.model.start();
    f.api.notificationConsent.mockRejectedValue(new Error("offline"));
    f.native.stop.mockRejectedValueOnce(new Error("bridge unavailable"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.model.snapshot().notice).toContain("중지 확인을 받지 못했어요");
    expect(f.model.snapshot().notice).not.toContain("판독을 중지했어요");
    expect(f.model.snapshot().result).toBeNull();
  });
  it("does not claim stopped until native shutdown confirms", async () => {
    const f = fixture(); await f.model.start();
    let finish!: () => void;
    f.native.stop.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const stopped = f.model.stop();
    expect(f.model.snapshot().phase).toBe("stopping");
    finish(); await stopped;
    expect(f.model.snapshot().phase).toBe("stopped");
  });
});
