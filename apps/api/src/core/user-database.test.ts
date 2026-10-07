import { describe, expect, it, vi } from "vitest";
import { UserDatabase } from "./user-database.js";

describe("user transaction failure isolation", () => {
  it("returns the result only after commit and releases the connection once", async () => {
    const release = vi.fn();
    const query = vi.fn(async () => ({ rows: [{ active: true }] }));
    const database = new UserDatabase({ connect: async () => ({ query, release }) } as never);
    await expect(database.run("11111111-1111-4111-8111-111111111111", async () => "result")).resolves.toBe("result");
    expect(query.mock.calls.at(-1)).toEqual(["commit"]);
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it.each([false, true])("does not return success after failed commit; rollback failure=%s", async rollbackFails => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql === "commit" || (sql === "rollback" && rollbackFails)) throw new Error("private driver detail");
      return { rows: [{ active: true }] };
    });
    const database = new UserDatabase({ connect: async () => ({ query, release }) } as never);
    await expect(database.run("11111111-1111-4111-8111-111111111111", async () => "must-not-return")).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
    expect(query.mock.calls.at(-1)).toEqual(["rollback"]);
    expect(release).toHaveBeenCalledExactlyOnceWith(rollbackFails);
  });
  it("destroys a pooled connection when rollback fails and hides driver details", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql === "rollback") throw new Error("private connection");
      return { rows: [{ active: true }] };
    });
    const database = new UserDatabase({ connect: async () => ({ query, release }) } as never);
    const result = database.run("11111111-1111-4111-8111-111111111111", async () => { throw new Error("SQL password"); });
    await expect(result).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
    await expect(result).rejects.not.toThrow(/SQL|password|connection/u);
    expect(release).toHaveBeenCalledWith(true);
  });
  it("rejects malformed ownership before opening a connection", async () => {
    const connect = vi.fn(); const database = new UserDatabase({ connect } as never);
    await expect(database.run("not-a-uuid", async () => 1)).rejects.toMatchObject({ status: 401 });
    expect(connect).not.toHaveBeenCalled();
  });
});
