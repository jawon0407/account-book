import { describe, expect, it, vi } from "vitest";
import { UserDatabase } from "./user-database.js";

describe("user transaction failure isolation", () => {
  it("denies invalid collector identity/version before acquiring a connection", async () => {
    const connect = vi.fn(), database = new UserDatabase({ connect } as never);
    const id = "11111111-1111-4111-8111-111111111111";
    for (const [sid, version] of [["bad",1],[id,0],[id,-1],[id,1.5],[id,2147483648],[id,NaN]] as const)
      await expect(database.runCollector(id,sid,version,async () => "no")).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(connect).not.toHaveBeenCalled();
  });
  it.each([false,undefined])("never invokes collection work without a positive lease result: %s", async allowed => {
    const operation = vi.fn(), release = vi.fn();
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("lock_active_collector") ? [{ allowed }] : [{ active: true }] }));
    const database = new UserDatabase({ connect: async () => ({ query,release }) } as never);
    await expect(database.runCollector("11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222",1,operation)).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(operation).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)).toEqual(["rollback"]);
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("keeps collector authorization and the write on the same connection until commit", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("lock_active_collector") ? [{ allowed: true }] : [{ active: true }] }));
    const client = { query,release }, database = new UserDatabase({ connect: async () => client } as never);
    const user = "11111111-1111-4111-8111-111111111111", sid = "22222222-2222-4222-8222-222222222222";
    await expect(database.runCollector(user,sid,7,async c => { expect(c).toBe(client); await c.query("write"); return "saved"; })).resolves.toBe("saved");
    expect(query.mock.calls.slice(-3)).toEqual([["select app_private.lock_active_collector($1,$2) as allowed",[sid,7]],["write"],["commit"]]);
  });
  it.each(["lease","write","commit"])("hides collector %s failures and rolls back", async stage => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if ((stage === "lease" && sql.includes("lock_active_collector")) || (stage === "commit" && sql === "commit")) throw new Error("private SQL");
      return { rows: [{ active: true,allowed: true }] };
    });
    const database = new UserDatabase({ connect: async () => ({ query,release }) } as never);
    await expect(database.runCollector("11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222",1,async () => { if (stage === "write") throw new Error("private SQL"); return 1; })).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
    expect(query.mock.calls.at(-1)).toEqual(["rollback"]);
  });
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
