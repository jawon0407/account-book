import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProviderDeadline } from "./provider-request-deadline.js";

vi.mock("server-only", () => ({}));

describe("createProviderDeadline", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => vi.useRealTimers());

  it("accepts 4999ms but aborts and rejects at 5000ms", async () => {
    const deadline = createProviderDeadline();
    const result = deadline.wait(() => new Promise<never>(() => {}));
    const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

    await vi.advanceTimersByTimeAsync(4_999);

    expect(deadline.signal.aborted).toBe(false);
    expect(() => deadline.assertActive()).not.toThrow();

    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(deadline.signal.aborted).toBe(true);
    expect(() => deadline.assertActive()).toThrow("AUTH_PROVIDER_UNAVAILABLE");

    deadline.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps concurrent operations isolated and clears their timers", () => {
    const first = createProviderDeadline();
    const second = createProviderDeadline();

    first.fail();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(() => second.assertActive()).not.toThrow();

    second.close();
    first.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects every pending waiter when the operation fails", async () => {
    const deadline = createProviderDeadline();
    const first = deadline.wait(() => new Promise<never>(() => {}));
    const second = deadline.wait(() => new Promise<never>(() => {}));
    const firstRejected = expect(first).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    const secondRejected = expect(second).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

    deadline.fail();

    await Promise.all([firstRejected, secondRejected]);
    expect(deadline.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    deadline.close();
  });

  it("uses the monotonic deadline when the timer callback is delayed", async () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(10);
    const deadline = createProviderDeadline();
    now.mockReturnValue(5_010);

    expect(() => deadline.assertActive()).toThrow("AUTH_PROVIDER_UNAVAILABLE");
    expect(deadline.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    deadline.close();
  });
});
