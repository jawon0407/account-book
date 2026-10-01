import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asCoreRole, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedAccount, seedCategory, seedUser } from "./support/core-fixtures.js";

let db: CoreDatabase;
let user: string, other: string, account: string, category: string;
beforeAll(async () => {
  db = await openCoreDatabase(); user = await seedUser(db.admin); other = await seedUser(db.admin);
  account = await seedAccount(db.admin, user); category = await seedCategory(db.admin, user); await seedAccount(db.admin, other);
});
afterAll(async () => { await db?.close(); });
const tables = ["accounts", "transaction_categories", "transaction_history", "account_transfers", "request_deduplication"];

describe("ledger runtime grants and owner RLS", () => {
  it("shows only own accounts and allows versioned edits", async () => {
    await asCoreRole(db.admin, "app_api", user, async () => {
      expect((await db.admin.query("select id from finance.accounts")).rows).toEqual([{ id: account }]);
      expect((await db.admin.query("update finance.accounts set name='수정' where id=$1 and version=1 returning version", [account])).rows).toEqual([{ version: "2" }]);
      expect((await db.admin.query("update finance.accounts set name='stale' where id=$1 and version=1", [account])).rowCount).toBe(0);
    });
  });
  it("allows a permitted expense and its tombstone, not hard deletion", async () => {
    await asCoreRole(db.admin, "app_api", user, async () => {
      const r = await db.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,'expense',4500,'2026-09-29') returning id", [user, account, category]);
      const deleted = await db.admin.query("update finance.transaction_history set deleted_at=clock_timestamp() where id=$1 returning version,deleted_at", [r.rows[0].id]);
      expect(deleted.rows[0].version).toBe("2"); expect(deleted.rows[0].deleted_at).not.toBeNull();
    });
    await expect(asCoreRole(db.admin, "app_api", user, () => db.admin.query("delete from finance.transaction_history"))).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects owner spoofing on creation", async () => {
    await expect(asCoreRole(db.admin, "app_api", user, () => db.admin.query("insert into finance.accounts(user_id,kind,name) values($1,'cash','spoof')", [other]))).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["anon", "authenticated", "service_role", "app_session_bff"] as const)("denies %s all ledger tables", async role => {
    for (const table of tables) await expect(asCoreRole(db.admin, role, user, () => db.admin.query(`select * from finance.${table}`))).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects protected columns and runtime ownership escalation", async () => {
    for (const sql of ["update finance.accounts set version=50", "update finance.accounts set kind='card'", "update finance.request_deduplication set operation='create_account'", "update finance.account_transfers set memo='edit'", "set role app_core_test_owner", "create table finance.forbidden(id int)", "select finance.validate_transfer_pair()"])
      await expect(asCoreRole(db.admin, "app_api", user, () => db.admin.query(sql))).rejects.toMatchObject({ code: "42501" });
  });
  it("denies unset and deleted owner contexts and clears pooled context", async () => {
    const deleted = await seedUser(db.admin); await seedAccount(db.admin, deleted);
    await db.admin.query("update \"user\".users set deleted_at=clock_timestamp() where user_id=$1", [deleted]);
    for (const id of [undefined, deleted]) await asCoreRole(db.admin, "app_api", id, async () => {
      for (const table of tables) expect((await db.admin.query(`select * from finance.${table}`)).rowCount).toBe(0);
    });
    await asCoreRole(db.admin, "app_api", user, async () => { expect((await db.admin.query("select * from finance.accounts")).rowCount).toBe(1); });
    await asCoreRole(db.admin, "app_api", undefined, async () => { expect((await db.admin.query("select * from finance.accounts")).rowCount).toBe(0); });
    await expect(asCoreRole(db.admin, "app_api", deleted, () => db.admin.query("insert into finance.accounts(user_id,kind,name) values($1,'cash','x')", [deleted]))).rejects.toMatchObject({ code: "42501" });
  });
});
