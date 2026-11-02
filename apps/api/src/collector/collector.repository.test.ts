import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../core/user-database.js";
import { CoreError } from "../core/core-error.js";
import { CollectorRepository } from "./collector.repository.js";

/** @param rows 합성 DB 함수 반환값. @returns 같은 transaction 콜백을 실행하는 가짜 DB와 저장소. */
function setup(rows: unknown[] = [{ version: 0, state: "inactive" }]) {
  const query = vi.fn(async () => ({ rows }));
  const run = vi.fn(async <T>(_user: string, operation: (client: DbClient) => Promise<T>): Promise<T> => operation({ query } as unknown as DbClient));
  return { query, run, repository: new CollectorRepository({ run }) };
}
describe("collector repository", () => {
  it("binds trusted identity/session to fixed parameterized functions", async () => {
    const s = setup();
    expect(await s.repository.get("user", "session")).toEqual({ version: 0, state: "inactive" });
    expect(s.run).toHaveBeenCalledWith("user", expect.any(Function));
    expect(s.query).toHaveBeenCalledWith("select * from app_private.collector_status($1)", ["session"]);
    await s.repository.change("user", "session", { action: "activate", expectedVersion: 0, replaceExisting: true });
    expect(s.query).toHaveBeenLastCalledWith("select * from app_private.collector_change($1,$2,$3,$4)", ["session", 0, "activate", true]);
    await s.repository.change("user", "session", { action: "deactivate", expectedVersion: 0 });
    expect(s.query).toHaveBeenLastCalledWith("select * from app_private.collector_change($1,$2,$3,$4)", ["session", 0, "deactivate", false]);
  });
  it.each([
    ["28000", "COLLECTOR_SESSION_INVALID", "AUTH_SESSION_EXPIRED", 401],
    ["22023", "COLLECTOR_INPUT_INVALID", "COLLECTOR_VALIDATION_FAILED", 400],
    ["P0001", "COLLECTOR_VERSION_CONFLICT", "COLLECTOR_VERSION_CONFLICT", 409],
    ["P0001", "COLLECTOR_REPLACE_REQUIRED", "COLLECTOR_REPLACE_REQUIRED", 409],
    ["P0001", "COLLECTOR_VERSION_EXHAUSTED", "COLLECTOR_SERVICE_UNAVAILABLE", 503],
    ["42501", "private table", "COLLECTOR_SERVICE_UNAVAILABLE", 503],
    ["P0001", "private secret", "COLLECTOR_SERVICE_UNAVAILABLE", 503],
  ])("maps only fixed SQL error %s %s", async (code, message, expected, status) => {
    const s = setup(); s.query.mockRejectedValueOnce(Object.assign(new Error(message), { code }));
    await expect(s.repository.change("user", "session", { action: "deactivate", expectedVersion: 1 })).rejects.toMatchObject({ code: expected, status, retryable: false });
  });
  it.each([[], [{ version: 0, state: "active_here" }], [{ version: 1, state: "inactive", secret: "private" }], [{ version: 1, state: "inactive" }, { version: 2, state: "inactive" }]].map(rows => ({ rows })))("fails closed on malformed rows %j", async ({ rows }) => {
    await expect(setup(rows).repository.get("user", "session")).rejects.toMatchObject({ code: "COLLECTOR_SERVICE_UNAVAILABLE", status: 503, retryable: true });
  });
  it("masks connection/commit failure, and preserves expired-user denial", async () => {
    const s = setup(); s.run.mockRejectedValueOnce(new CoreError("LEDGER_SERVICE_UNAVAILABLE", 503, true));
    await expect(s.repository.change("user", "session", { action: "deactivate", expectedVersion: 1 })).rejects.toMatchObject({ code: "COLLECTOR_SERVICE_UNAVAILABLE", retryable: false });
    s.run.mockRejectedValueOnce(new CoreError("AUTH_SESSION_EXPIRED", 401));
    await expect(s.repository.get("user", "session")).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED", status: 401 });
  });
});
