import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedAccount, seedCategory, seedUser } from "./support/core-fixtures.js";

let db: CoreDatabase;
let user: string, account: string, category: string;
beforeAll(async () => { db = await openCoreDatabase(); });
afterAll(async () => { await db?.close(); });

describe("ledger storage constraints", () => {
  it("creates all five ledger tables", async () => {
    expect((await db.admin.query("select tablename from pg_tables where schemaname='finance' order by tablename")).rows.map(r => r.tablename))
      .toEqual(["account_transfers", "accounts", "request_deduplication", "transaction_categories", "transaction_history"]);
    user = await seedUser(db.admin); account = await seedAccount(db.admin, user); category = await seedCategory(db.admin, user);
  });
  it("stores an ordinary expense with defaults", async () => {
    const r = await db.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,'expense',4500,'2026-09-29') returning kind,amount_krw,version,deleted_at", [user, account, category]);
    expect(r.rows).toEqual([{ kind: "expense", amount_krw: "4500", version: "1", deleted_at: null }]);
  });
  it.each(["0", "-1", "9007199254740992"])("rejects amount %s", async amount => {
    await expect(db.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,'expense',$4,'2026-09-29')", [user, account, category, amount])).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["infinity", "10000-01-01", "0001-01-01 BC"])("rejects out-of-contract date %s", async date => {
    await expect(db.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,'expense',1,$4)", [user, account, category, date])).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["", " ", "x".repeat(501)])("rejects invalid memo %#", async memo => {
    await expect(db.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on,memo) values($1,$2,$3,'expense',1,'2026-09-29',$4)", [user, account, category, memo])).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects another owner's account or category and mismatched category kind", async () => {
    const other = await seedUser(db.admin), otherAccount = await seedAccount(db.admin, other), otherCategory = await seedCategory(db.admin, other);
    for (const [acc, cat, kind] of [[otherAccount, category, "expense"], [account, otherCategory, "expense"], [account, category, "income"]]) {
      await expect(db.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,$4,1,'2026-09-29')", [user, acc, cat, kind])).rejects.toMatchObject({ code: "23503" });
    }
  });
  it("allows exactly one opening balance and validates its direction", async () => {
    const params = [user, account];
    const sql = "insert into finance.transaction_history(user_id,account_id,kind,amount_krw,occurred_on,opening_direction) values($1,$2,'opening_balance',100,'2026-09-29','asset')";
    await db.admin.query(sql, params);
    await expect(db.admin.query(sql, params)).rejects.toMatchObject({ code: "23505" });
    await expect(db.admin.query(sql.replace("'asset'", "null"), params)).rejects.toMatchObject({ code: "23514" });
  });
  it("protects user deletion while financial rows exist", async () => {
    await expect(db.admin.query("delete from auth.users where id=$1", [user])).rejects.toMatchObject({ code: "23503" });
    expect((await db.admin.query("select 1 from \"user\".users where user_id=$1", [user])).rowCount).toBe(1);
  });
  it("validates account/category bounds and immutable kinds", async () => {
    for (const name of ["", " padded ", "x".repeat(81)]) await expect(db.admin.query("insert into finance.accounts(user_id,kind,name) values($1,'cash',$2)", [user, name])).rejects.toMatchObject({ code: "23514" });
    await expect(db.admin.query("insert into finance.transaction_categories(user_id,kind,name,sort_order) values($1,'expense','test',10001)", [user])).rejects.toMatchObject({ code: "23514" });
    await expect(db.admin.query("update finance.accounts set kind='card' where id=$1", [account])).rejects.toMatchObject({ code: "23514" });
  });
  it("scopes idempotency by owner and operation and enforces request shapes", async () => {
    const key = randomUUID();
    const sql = "insert into finance.request_deduplication(user_id,operation,idempotency_key,request_fingerprint,response_snapshot) values($1,$2,$3,$4,$5)";
    const values = [user, "create_transaction", key, Buffer.alloc(32), { id: randomUUID() }];
    await db.admin.query(sql, values);
    await expect(db.admin.query(sql, values)).rejects.toMatchObject({ code: "23505" });
    await db.admin.query(sql, [user, "create_account", key, Buffer.alloc(32), {}]);
    const other = await seedUser(db.admin);
    await db.admin.query(sql, [other, "create_transaction", key, Buffer.alloc(32), {}]);
    for (const [fingerprint, response] of [[Buffer.alloc(31), {}], [Buffer.alloc(32), []], [Buffer.alloc(32), { data: "x".repeat(16384) }]]) {
      await expect(db.admin.query(sql, [user, "create_transaction", randomUUID(), fingerprint, JSON.stringify(response)])).rejects.toMatchObject({ code: "23514" });
    }
    await expect(db.admin.query(sql, [user, "create_transaction", "11111111-1111-1111-8111-111111111111", Buffer.alloc(32), {}])).rejects.toMatchObject({ code: "23514" });
  });
});
