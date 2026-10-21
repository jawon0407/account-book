import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { asCoreRole, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";

let db: CoreDatabase;
beforeAll(async () => { db = await openCoreDatabase(process.env, true, true, false); });
afterAll(async () => { await db?.close(); });

it("adds evidence without rewriting old DATE values, IDs, amounts, versions, grants or RLS", async () => {
  const owner = await seedUser(db.admin);
  const old = (await db.admin.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on) values($1,'expense',123,'2026-10-01') returning *", [owner])).rows[0];
  const accessSql = "select oid,relacl,relrowsecurity,relforcerowsecurity from pg_class where oid='finance.transaction_history'::regclass";
  const before = (await db.admin.query(accessSql)).rows;
  await db.admin.query("begin; set local role app_core_test_owner");
  try {
    await db.admin.query(await readFile(new URL("../../supabase/migrations/20261016074408_ledger_time_storage.sql", import.meta.url), "utf8"));
    await db.admin.query("commit");
  } catch (error) { await db.admin.query("rollback"); throw error; }
  expect((await db.admin.query("select * from finance.transaction_history where id=$1", [old.id])).rows).toEqual([{
    ...old, occurred_at: null, time_precision: "day", time_source: "legacy_date", source_time_zone: null, ledger_time_zone: null,
  }]);
  expect((await db.admin.query(accessSql)).rows).toEqual(before);
  await asCoreRole(db.admin, "app_api", owner, async () => {
    const row = (await db.admin.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on) values($1,'income',456,'2026-10-02') returning occurred_at,time_precision,time_source", [owner])).rows[0];
    expect(row).toEqual({ occurred_at: null, time_precision: "day", time_source: "legacy_date" });
    expect((await db.admin.query('select * from "user".ledger_time_history')).rowCount).toBe(0);
  });
});
