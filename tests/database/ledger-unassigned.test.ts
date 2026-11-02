import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asCoreRole, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedAccount, seedCategory, seedUser } from "./support/core-fixtures.js";

describe("unassigned ledger references", () => {
  let db: CoreDatabase;
  beforeAll(async () => { db = await openCoreDatabase(); });
  afterAll(async () => { await db?.close(); });

  it("stores all four nullable combinations through the minimum-privilege API role", async () => {
    const user = await seedUser(db.admin), account = await seedAccount(db.admin, user), category = await seedCategory(db.admin, user);
    for (const accountId of [account, null]) for (const categoryId of [category, null]) {
      await asCoreRole(db.admin, "app_api", user, async () => {
        const result = await db.admin.query(`insert into finance.transaction_history
          (user_id,account_id,category_id,kind,amount_krw,occurred_on,counterparty_name)
          values($1,$2,$3,'expense',100,'2026-10-16','합성 상점') returning id,account_id,category_id,counterparty_name`, [user,accountId,categoryId]);
        expect(result.rows[0]).toMatchObject({ account_id: accountId, category_id: categoryId, counterparty_name: "합성 상점" });
        await db.admin.query("update finance.transaction_history set counterparty_name=null,account_id=null,category_id=null where id=$1", [result.rows[0].id]);
      });
    }
  });

  it("keeps owner and special-kind constraints when references can be absent", async () => {
    const user = await seedUser(db.admin), other = await seedUser(db.admin), account = await seedAccount(db.admin, other), category = await seedCategory(db.admin, other);
    for (const [acc, cat] of [[account, null], [null, category]]) {
      await expect(db.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,'expense',100,'2026-10-16')", [user,acc,cat])).rejects.toMatchObject({ code: "23503" });
    }
    for (const kind of ["transfer_out", "transfer_in", "opening_balance"]) {
      await expect(db.admin.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on,opening_direction) values($1,$2,100,'2026-10-16',$3)", [user,kind,kind === "opening_balance" ? "asset" : null])).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("rejects blank/oversized counterparties and hides new values from other users and BFF", async () => {
    const user = await seedUser(db.admin), other = await seedUser(db.admin);
    for (const value of ["", "   ", "x".repeat(201)]) {
      await expect(db.admin.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on,counterparty_name) values($1,'income',100,'2026-10-16',$2)", [user,value])).rejects.toMatchObject({ code: "23514" });
    }
    await db.admin.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on,counterparty_name) values($1,'income',100,'2026-10-16','합성 상대')", [user]);
    await asCoreRole(db.admin, "app_api", other, async () => {
      expect((await db.admin.query("select counterparty_name from finance.transaction_history where user_id=$1", [user])).rows).toEqual([]);
    });
    await expect(asCoreRole(db.admin, "app_session_bff", user, () => db.admin.query("select counterparty_name from finance.transaction_history"))).rejects.toMatchObject({ code: "42501" });
  });
});
