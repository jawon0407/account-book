import { describe, expect, it, vi } from "vitest";
import type { CollectorState } from "@account-book/contracts";
import { ClientError } from "../api/client-error";
import { CollectorSettings } from "./collector-settings";

const inactive: CollectorState = { version: 0, state: "inactive" };
const here: CollectorState = { version: 1, state: "active_here" };
const elsewhere: CollectorState = { version: 2, state: "active_elsewhere" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(state = inactive) {
  const api = {
    collectorState: vi.fn(async () => state),
    changeCollector: vi.fn(async () => here),
  };
  return { api, model: new CollectorSettings(api) };
}
describe("collector settings transitions", () => {
  it.each([inactive, here, elsewhere])(
    "reads %j without writing on entry",
    async (value) => {
      const { api, model } = fixture(value);
      await model.start();
      expect(model.snapshot()).toMatchObject({
        phase: "ready",
        value,
        confirmation: null,
      });
      expect(api.changeCollector).not.toHaveBeenCalled();
    },
  );
  it("requires explicit confirmation, supports cancel and captures read version", async () => {
    const { api, model } = fixture();
    await model.start();
    model.choose("activate");
    expect(model.snapshot().confirmation).toEqual({
      action: "activate",
      expectedVersion: 0,
      replaceExisting: false,
    });
    model.cancel();
    await model.confirm();
    expect(api.changeCollector).not.toHaveBeenCalled();
    model.choose("activate");
    await model.confirm();
    expect(api.changeCollector).toHaveBeenCalledExactlyOnceWith({
      action: "activate",
      expectedVersion: 0,
      replaceExisting: false,
    });
    expect(model.snapshot()).toMatchObject({
      phase: "ready",
      value: here,
      confirmation: null,
    });
  });
  it("only explicitly confirmed replacement sends replaceExisting true", async () => {
    const { api, model } = fixture(elsewhere);
    await model.start();
    model.choose("activate");
    expect(api.changeCollector).not.toHaveBeenCalled();
    await model.confirm();
    expect(api.changeCollector).toHaveBeenCalledWith({
      action: "activate",
      expectedVersion: 2,
      replaceExisting: true,
    });
  });
  it.each([here, elsewhere])(
    "confirms deactivation for %j",
    async (current) => {
      const { api, model } = fixture(current);
      await model.start();
      model.choose("deactivate");
      await model.confirm();
      expect(api.changeCollector).toHaveBeenCalledWith({
        action: "deactivate",
        expectedVersion: current.version,
      });
    },
  );
  it("ignores inapplicable commands", async () => {
    const a = fixture();
    await a.model.start();
    a.model.choose("deactivate");
    await a.model.confirm();
    const b = fixture(here);
    await b.model.start();
    b.model.choose("activate");
    await b.model.confirm();
    expect(a.api.changeCollector).not.toHaveBeenCalled();
    expect(b.api.changeCollector).not.toHaveBeenCalled();
  });
  it("locks double taps and reload while saving and never shows early success", async () => {
    const { api, model } = fixture(),
      pending = deferred<CollectorState>();
    api.changeCollector.mockReturnValueOnce(pending.promise);
    await model.start();
    model.choose("activate");
    const save = model.confirm();
    await model.confirm();
    await model.reload();
    model.choose("deactivate");
    expect(api.changeCollector).toHaveBeenCalledTimes(1);
    expect(api.collectorState).toHaveBeenCalledTimes(1);
    expect(model.snapshot()).toMatchObject({
      phase: "saving",
      value: inactive,
      notice: null,
    });
    pending.resolve(here);
    await save;
    expect(model.snapshot().value).toEqual(here);
  });
  it.each([
    "COLLECTOR_VERSION_CONFLICT",
    "COLLECTOR_REPLACE_REQUIRED",
    "NETWORK",
  ] as const)("reconciles %s by GET without replaying PATCH", async (code) => {
    const { api, model } = fixture();
    await model.start();
    api.changeCollector.mockRejectedValueOnce(new ClientError(code));
    api.collectorState.mockResolvedValueOnce(elsewhere);
    model.choose("activate");
    await model.confirm();
    expect(api.changeCollector).toHaveBeenCalledTimes(1);
    expect(api.collectorState).toHaveBeenCalledTimes(2);
    expect(model.snapshot()).toMatchObject({
      phase: "ready",
      value: elsewhere,
      confirmation: null,
    });
    expect(model.snapshot().notice).not.toBeNull();
    expect(model.snapshot().notice).not.toContain("저장했어요");
  });
  it("cannot claim success even if a lost-response follow-up GET says active_here", async () => {
    const { api, model } = fixture();
    await model.start();
    api.changeCollector.mockRejectedValueOnce(new ClientError("NETWORK"));
    api.collectorState.mockResolvedValueOnce(here);
    model.choose("activate");
    await model.confirm();
    expect(model.snapshot().value).toEqual(here);
    expect(model.snapshot().notice).toContain("결과를 확정할 수 없어요");
  });
  it("locks changes if follow-up GET fails, then unlocks only on an explicit successful reload", async () => {
    const { api, model } = fixture();
    await model.start();
    api.changeCollector.mockRejectedValueOnce(new ClientError("NETWORK"));
    api.collectorState.mockRejectedValueOnce(new ClientError("NETWORK"));
    model.choose("activate");
    await model.confirm();
    expect(model.snapshot()).toMatchObject({
      phase: "error",
      value: null,
      confirmation: null,
    });
    model.choose("activate");
    await model.confirm();
    expect(api.changeCollector).toHaveBeenCalledTimes(1);
    await model.reload();
    expect(model.snapshot().phase).toBe("ready");
  });
  it("discards confirmation on reload and does not use an old version", async () => {
    const { api, model } = fixture();
    await model.start();
    model.choose("activate");
    api.collectorState.mockResolvedValueOnce(elsewhere);
    await model.reload();
    await model.confirm();
    expect(api.changeCollector).not.toHaveBeenCalled();
    model.choose("activate");
    expect(model.snapshot().confirmation?.expectedVersion).toBe(2);
  });
  it("drops late reads and can restart after effect cleanup", async () => {
    const { api, model } = fixture(),
      late = deferred<CollectorState>();
    api.collectorState.mockReturnValueOnce(late.promise);
    const first = model.start();
    model.stop();
    api.collectorState.mockResolvedValueOnce(elsewhere);
    await model.start();
    late.resolve(here);
    await first;
    expect(model.snapshot().value).toEqual(elsewhere);
  });
  it("does not requery or publish an old successful mutation after leaving", async () => {
    const { api, model } = fixture(),
      late = deferred<CollectorState>();
    await model.start();
    api.changeCollector.mockReturnValueOnce(late.promise);
    model.choose("activate");
    const save = model.confirm();
    model.stop();
    late.resolve(here);
    await save;
    expect(model.snapshot()).toMatchObject({ phase: "idle", value: null });
    expect(api.collectorState).toHaveBeenCalledTimes(1);
  });
  it("reports a failed initial read with no enabled write or raw exception", async () => {
    const { api, model } = fixture();
    api.collectorState.mockRejectedValueOnce(new Error("secret SQL/token"));
    await model.start();
    model.choose("activate");
    await model.confirm();
    expect(model.snapshot().phase).toBe("error");
    expect(model.snapshot().notice).not.toContain("secret");
    expect(api.changeCollector).not.toHaveBeenCalled();
  });
});
