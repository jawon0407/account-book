import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asCoreRole, CORE_URL, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedAccount, seedCategory, seedUser } from "./support/core-fixtures.js";

let db: CoreDatabase;
let user: string, from: string, to: string;
beforeAll(async () => { db = await openCoreDatabase(); user = await seedUser(db.admin); from = await seedAccount(db.admin, user); to = await seedAccount(db.admin, user); });
afterAll(async () => { await db?.close(); });

/** @param client 연결. @param count 자식 거래 수. @param mismatch 잘못된 입금액. @param options 불일치 필드/반대 방향 fixture. @returns 이체 ID. */
async function transfer(client: Client, count = 2, mismatch = false, options: { field?: "memo" | "date"; reverse?: boolean } = {}): Promise<string> {
  const source = options.reverse ? to : from, target = options.reverse ? from : to;
  const r = await client.query("insert into finance.account_transfers(user_id,from_account_id,to_account_id,amount_krw,occurred_on) values($1,$2,$3,10000,'2026-09-29') returning id", [user, source, target]);
  const id = r.rows[0].id;
  for (let i = 0; i < count; i++) await client.query("insert into finance.transaction_history(user_id,account_id,kind,amount_krw,occurred_on,transfer_id,memo) values($1,$2,$3,$4,$5,$6,$7)", [user, i === 0 ? source : target, i === 0 ? "transfer_out" : "transfer_in", mismatch && i === 1 ? 9000 : 10000, options.field === "date" && i === 1 ? "2026-09-30" : "2026-09-29", id, options.field === "memo" && i === 1 ? "불일치" : null]);
  return id;
}

describe("transfer atomicity and reference locks", () => {
  it.each([0, 1, 3])("rejects transfer with %i child entries at commit", async count => {
    await db.admin.query("begin");
    try { await transfer(db.admin, count); await expect(db.admin.query("commit")).rejects.toMatchObject({ code: "23514" }); }
    finally { await db.admin.query("rollback"); }
  });
  it("rejects mismatched amount at commit", async () => {
    await db.admin.query("begin");
    try { await transfer(db.admin, 2, true); await expect(db.admin.query("commit")).rejects.toMatchObject({ code: "23514" }); }
    finally { await db.admin.query("rollback"); }
  });
  it.each(["memo", "date"] as const)("rejects mismatched %s at commit", async field => {
    await db.admin.query("begin");
    try { await transfer(db.admin,2,false,{field}); await expect(db.admin.query("commit")).rejects.toMatchObject({ code: "23514" }); }
    finally { await db.admin.query("rollback"); }
  });
  it("commits a pair using actual API privileges and refuses one-sided edits", async () => {
    await db.admin.query("set session authorization app_api; begin");
    let id: string;
    try { await db.admin.query("select set_config('app.user_id',$1,true)", [user]); id = await transfer(db.admin); await db.admin.query("commit"); }
    finally { await db.admin.query("rollback; reset session authorization"); }
    expect((await db.admin.query("select count(*)::int as count from finance.transaction_history where transfer_id=$1", [id!])).rows[0].count).toBe(2);
    await expect(asCoreRole(db.admin, "app_api", user, () => db.admin.query("update finance.transaction_history set amount_krw=1 where transfer_id=$1", [id!]))).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects same-account transfer before commit", async () => {
    await expect(db.admin.query("insert into finance.account_transfers(user_id,from_account_id,to_account_id,amount_krw,occurred_on) values($1,$2,$2,1,'2026-09-29')", [user, from])).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects new references to archived account/category but allows old memo edits", async () => {
    const account = await seedAccount(db.admin, user), category = await seedCategory(db.admin, user);
    const sql = "insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,'expense',1,'2026-09-29') returning id";
    const id = (await db.admin.query(sql, [user, account, category])).rows[0].id;
    await db.admin.query("update finance.accounts set archived_at=clock_timestamp() where id=$1", [account]);
    await expect(db.admin.query(sql, [user, account, category])).rejects.toMatchObject({ code: "23514" });
    await db.admin.query("update finance.transaction_history set memo='과거 거래' where id=$1", [id]);
    await db.admin.query("update finance.transaction_categories set archived_at=clock_timestamp() where id=$1", [category]);
    await expect(db.admin.query(sql, [user, from, category])).rejects.toMatchObject({ code: "23514" });
  });
  it("serializes archive versus new expense through an account row lock", async () => {
    const account = await seedAccount(db.admin, user), category = await seedCategory(db.admin, user);
    const a = new Client({ connectionString: CORE_URL }), b = new Client({ connectionString: CORE_URL });
    await a.connect(); await b.connect();
    try {
      await a.query("begin"); await a.query("update finance.accounts set archived_at=clock_timestamp() where id=$1", [account]);
      // lock_timeout은 잠금 대기 발생 자체를 증명한다. 임의 sleep으로 성공을 추측하지 않는다.
      await b.query("set lock_timeout='100ms'");
      await expect(b.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,'expense',1,'2026-09-29')", [user, account, category])).rejects.toMatchObject({ code: "55P03" });
      await a.query("commit");
      await expect(b.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,'expense',1,'2026-09-29')", [user, account, category])).rejects.toMatchObject({ code: "23514" });
    } finally { await a.query("rollback"); await a.end(); await b.end(); }
  });
  it("completes opposite-direction transfers concurrently without partial pairs", async () => {
    const a = new Client({ connectionString: CORE_URL }), b = new Client({ connectionString: CORE_URL });
    await a.connect(); await b.connect();
    try {
      await Promise.all([a,b].map(c => c.query("begin; set local statement_timeout='3s'")));
      const ids = await Promise.all([a,b].map(async (c,index) => {
        const id = await transfer(c,2,false,{reverse:index === 1}); await c.query("commit"); return id;
      }));
      expect((await db.admin.query("select count(*)::int as count from finance.transaction_history where transfer_id=any($1::uuid[])", [ids])).rows[0].count).toBe(4);
    } finally { await a.query("rollback"); await b.query("rollback"); await a.end(); await b.end(); }
  });
});
