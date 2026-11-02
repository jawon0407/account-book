import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../core/user-database.js";
import { CoreError } from "../core/core-error.js";
import { NotificationConsentRepository } from "./notification-consent.repository.js";

const state = { version: 1,state: "granted",noticeVersion: "notification-access-v1" };
/** @param rows DB 반환 모의 값. @returns 같은 transaction으로 작업하는 저장소. */
function setup(rows: unknown[] = [state]) {
  const query = vi.fn(async () => ({ rows }));
  const run = vi.fn(async <T>(_id: string, operation: (c: DbClient) => Promise<T>): Promise<T> => operation({ query } as unknown as DbClient));
  return { query,run,repo: new NotificationConsentRepository({ run }) };
}
describe("notification consent repository", () => {
  it("binds verified identity/session and never accepts client installation or time", async () => {
    const s = setup(); expect(await s.repo.get("user","sid")).toEqual(state);
    expect(s.run).toHaveBeenCalledWith("user",expect.any(Function));
    expect(s.query).toHaveBeenLastCalledWith("select * from app_private.notification_consent_status($1)",["sid"]);
    await s.repo.change("user","sid",{ action: "accept",expectedVersion: 0,noticeVersion: "notification-access-v1" });
    expect(s.query).toHaveBeenLastCalledWith("select * from app_private.notification_consent_change($1,$2,$3,$4)",["sid",0,"accept","notification-access-v1"]);
    await s.repo.change("user","sid",{ action: "withdraw",expectedVersion: 1 });
    expect(s.query).toHaveBeenLastCalledWith("select * from app_private.notification_consent_change($1,$2,$3,$4)",["sid",1,"withdraw",null]);
  });
  it.each([
    ["28000","COLLECTOR_SESSION_INVALID","AUTH_SESSION_EXPIRED",401],
    ["22023","COLLECTOR_INPUT_INVALID","COLLECTOR_VALIDATION_FAILED",400],
    ["P0001","COLLECTOR_VERSION_CONFLICT","COLLECTOR_VERSION_CONFLICT",409],
    ["P0001","CONSENT_VERSION_EXHAUSTED","COLLECTOR_SERVICE_UNAVAILABLE",503],
    ["42501","private secret","COLLECTOR_SERVICE_UNAVAILABLE",503],
  ])("maps SQL error without retrying mutation: %s/%s", async (code,message,expected,status) => {
    const s = setup(); s.query.mockRejectedValueOnce(Object.assign(new Error(message),{ code }));
    await expect(s.repo.change("user","sid",{ action: "withdraw",expectedVersion: 1 })).rejects.toMatchObject({ code: expected,status,retryable: false });
  });
  it.each([[],[state,state],[{ ...state,deviceId: "secret" }],[{ ...state,version: 0 }]].map(rows => ({ rows })))("rejects malformed/private rows %j", async ({ rows }) => {
    await expect(setup(rows).repo.get("user","sid")).rejects.toMatchObject({ code: "COLLECTOR_SERVICE_UNAVAILABLE",retryable: true });
  });
  it("masks failed connection/commit but preserves authenticated-user denial", async () => {
    const s = setup(); s.run.mockRejectedValueOnce(new CoreError("LEDGER_SERVICE_UNAVAILABLE",503,true));
    await expect(s.repo.change("user","sid",{ action: "withdraw",expectedVersion: 1 })).rejects.toMatchObject({ code: "COLLECTOR_SERVICE_UNAVAILABLE",retryable: false });
    s.run.mockRejectedValueOnce(new CoreError("AUTH_SESSION_EXPIRED",401));
    await expect(s.repo.get("user","sid")).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
  });
});
