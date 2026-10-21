import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserDatabase, type DbClient } from "../../apps/api/src/core/user-database.js";
import { CORE_URL, type CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";
import { changeCollector, openCollectorDatabase, seedCollectorSession, withCollectorClient } from "./support/collector-fixtures.js";

describe("collector transaction runner with real RLS", () => {
  let fixture: CoreDatabase, pool: Pool, database: UserDatabase;
  beforeAll(async () => {
    fixture = await openCollectorDatabase();
    const password = randomBytes(24).toString("hex");
    await fixture.admin.query(`create role collector_api_runner login password '${password}' in role app_api`);
    const url = new URL(CORE_URL); url.username = "collector_api_runner"; url.password = password;
    pool = new Pool({ connectionString: url.href,max: 2 }); database = new UserDatabase(pool);
  });
  afterAll(async () => { await pool?.end(); if (fixture) { await fixture.admin.query("drop role collector_api_runner"); await fixture.close(); } });
  /** @param client 동일 transaction의 연결. @param userId 합성 회원. @returns 새 원장 ID. */
  async function insert(client: DbClient, userId: string): Promise<string> {
    return (await client.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on) values($1,'expense',100,'2026-10-16') returning id",[userId])).rows[0].id;
  }

  it("creates only for the active generation, without limiting manual entry on another device", async () => {
    const user = await seedUser(fixture.admin), a = await seedCollectorSession(fixture.admin,user), b = await seedCollectorSession(fixture.admin,user);
    await expect(database.runCollector(user,a,1,c => insert(c,user))).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    await withCollectorClient(user,c => changeCollector(c,a,0));
    expect(await database.runCollector(user,a,1,c => insert(c,user))).toMatch(/^[0-9a-f-]{36}$/u);
    await withCollectorClient(user,c => changeCollector(c,b,1,"activate",true));
    await expect(database.runCollector(user,a,1,c => insert(c,user))).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    await expect(database.runCollector(user,b,1,c => insert(c,user))).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    await database.runCollector(user,b,2,c => insert(c,user));
    await database.run(user,c => insert(c,user));
    expect((await fixture.admin.query("select count(*)::int as n from finance.transaction_history where user_id=$1",[user])).rows[0].n).toBe(3);
  });

  it("rolls back partial writes and isolates other users even with a valid session id", async () => {
    const user = await seedUser(fixture.admin), other = await seedUser(fixture.admin), sid = await seedCollectorSession(fixture.admin,user);
    await withCollectorClient(user,c => changeCollector(c,sid,0));
    await expect(database.runCollector(other,sid,1,c => insert(c,other))).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    await expect(database.runCollector(user,sid,1,async c => { await insert(c,user); throw new Error("private"); })).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
    expect((await fixture.admin.query("select count(*)::int as n from finance.transaction_history where user_id in ($1,$2)",[user,other])).rows[0].n).toBe(0);
  });
});
