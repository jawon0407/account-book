import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedAccount, seedCategory, seedUser } from "./support/core-fixtures.js";

let db: CoreDatabase;
beforeAll(async () => { db = await openCoreDatabase(process.env, true, false); });
afterAll(async () => { await db?.close(); });

it("upgrades existing rows without changing identity, values, RLS or function privileges", async () => {
  const user = await seedUser(db.admin), account = await seedAccount(db.admin, user), category = await seedCategory(db.admin, user);
  const old = (await db.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on,memo) values($1,$2,$3,'expense',123,'2026-10-01','보존') returning *", [user,account,category])).rows[0];
  // 이관 전에는 같은 미지정 입출금이 거부됨을 실제 DB에서 증명한다.
  await expect(db.admin.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on) values($1,'income',100,'2026-10-16')", [user])).rejects.toBeDefined();
  const accessSql = "select oid,relacl,relrowsecurity,relforcerowsecurity from pg_class where oid='finance.transaction_history'::regclass";
  const functionSql = "select oid,proowner,proacl,proconfig,prosecdef from pg_proc where oid='finance.guard_transaction_reference()'::regprocedure";
  const access = (await db.admin.query(accessSql)).rows, func = (await db.admin.query(functionSql)).rows;
  await db.admin.query("begin");
  try {
    await db.admin.query("set local role app_core_test_owner");
    await db.admin.query(await readFile(new URL("../../supabase/migrations/20261015165313_ledger_unassigned_counterparty.sql", import.meta.url), "utf8"));
    await db.admin.query("commit");
  } catch (error) { await db.admin.query("rollback"); throw error; }
  expect((await db.admin.query("select * from finance.transaction_history where id=$1", [old.id])).rows).toEqual([{ ...old, counterparty_name: null }]);
  expect((await db.admin.query(accessSql)).rows).toEqual(access);
  expect((await db.admin.query(functionSql)).rows).toEqual(func);
  expect((await db.admin.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on) values($1,'income',100,'2026-10-16') returning account_id,category_id,counterparty_name", [user])).rows).toEqual([{ account_id: null, category_id: null, counterparty_name: null }]);
});
