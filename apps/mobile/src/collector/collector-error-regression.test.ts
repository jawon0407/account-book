import { describe, expect, it, vi } from "vitest";
import type { CollectorState } from "@account-book/contracts";
import { ClientError } from "../api/client-error";
import { CollectorSettings } from "./collector-settings";

const inactive: CollectorState = { version: 0, state: "inactive" };
const elsewhere: CollectorState = { version: 2, state: "active_elsewhere" };

/** 네트워크만 대역으로 두고 실제 화면 모델의 상태 전이를 검사한다. */
function fixture() {
  const api = {
    collectorState: vi.fn(async () => inactive),
    changeCollector: vi.fn(async (): Promise<CollectorState> => elsewhere),
  };
  return { api, model: new CollectorSettings(api) };
}

describe("collector errors preserve screen lifetime and recovery choices", () => {
  it.each(["leave", "restart"] as const)(
    "ignores a late rejected mutation after %s without GET or state publication",
    async (transition) => {
      const { api, model } = fixture();
      let reject!: (error: unknown) => void;
      api.changeCollector.mockReturnValueOnce(
        new Promise((_, fail) => {
          reject = fail;
        }),
      );
      await model.start();
      model.choose("activate");
      const saving = model.confirm();
      model.stop();
      if (transition === "restart") {
        api.collectorState.mockResolvedValueOnce(elsewhere);
        await model.start();
      }
      const current = model.snapshot();
      const listener = vi.fn();
      const unsubscribe = model.subscribe(listener);
      reject(new ClientError("NETWORK"));
      await saving;

      expect(model.snapshot()).toBe(current);
      expect(current).toMatchObject(
        transition === "restart"
          ? { phase: "ready", value: elsewhere, notice: null }
          : { phase: "idle", value: null, notice: null },
      );
      expect(listener).not.toHaveBeenCalled();
      expect(api.collectorState).toHaveBeenCalledTimes(
        transition === "restart" ? 2 : 1,
      );
      expect(api.changeCollector).toHaveBeenCalledTimes(1);
      unsubscribe();
    },
  );

  it.each([
    ["COLLECTOR_VERSION_CONFLICT", "변경됐어요", "다시 선택"],
    ["COLLECTOR_REPLACE_REQUIRED", "다른 기기", "교체"],
  ] as const)(
    "explains %s after a read without replaying the change",
    async (code, reason, action) => {
      const { api, model } = fixture();
      await model.start();
      api.changeCollector.mockRejectedValueOnce(new ClientError(code, 409));
      api.collectorState.mockResolvedValueOnce(elsewhere);
      model.choose("activate");
      await model.confirm();

      expect(model.snapshot()).toMatchObject({
        phase: "ready",
        value: elsewhere,
        confirmation: null,
      });
      expect(model.snapshot().notice).toContain(reason);
      expect(model.snapshot().notice).toContain(action);
      expect(model.snapshot().notice).not.toContain("저장했어요");
      expect(api.changeCollector).toHaveBeenCalledTimes(1);
      expect(api.collectorState).toHaveBeenCalledTimes(2);
      // 재조회 뒤에도 새 버전으로 사용자가 교체를 확인하기 전에는 쓰지 않는다.
      await model.confirm();
      expect(api.changeCollector).toHaveBeenCalledTimes(1);
      model.choose("activate");
      expect(model.snapshot().confirmation).toEqual({
        action: "activate",
        expectedVersion: 2,
        replaceExisting: true,
      });
    },
  );
});
