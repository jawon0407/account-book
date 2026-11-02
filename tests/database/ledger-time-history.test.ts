import { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { asCoreRole, CORE_URL, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";

let db: CoreDatabase;
beforeAll(async () => { db = await openCoreDatabase(); });
afterAll(async () => { await db?.close(); });

/** @param client 로컬 DB 연결. @param user 소유자. @param zone 새 거주 시간대. @returns DB가 정한 순번과 효력 시각. */
async function add(client: Client, user: string, zone = "Asia/Seoul") {
  return (await client.query('insert into "user".ledger_time_history(user_id,time_zone) values($1,$2) returning *', [user, zone])).rows[0];
}

it("creates baseline only on explicit setting and subsequent append leaves old history intact", async () => {
  const user = await seedUser(db.admin);
  await asCoreRole(db.admin, "app_api", user, async () => {
    expect((await db.admin.query('select * from "user".ledger_time_history')).rowCount).toBe(0);
    const baseline = await add(db.admin, user);
    expect(baseline.revision).toBe("1");
    expect(baseline.effective_from).toBeNull();
    const next = await add(db.admin, user, "America/Los_Angeles");
    expect(next.revision).toBe("2");
    expect(next.effective_from).toBeInstanceOf(Date);
    expect(next.effective_from).toEqual(next.created_at);
    const rows = (await db.admin.query('select * from "user".ledger_time_history order by revision')).rows;
    expect(rows).toEqual([baseline, next]);
  });
});

it.each(["KST", "+09:00", "Asia/Nowhere", "", "UTC "])("rejects unsupported residence timezone %j", async zone => {
  const user = await seedUser(db.admin);
  await expect(asCoreRole(db.admin, "app_api", user, () => add(db.admin, user, zone))).rejects.toBeDefined();
});

it("rejects duplicate consecutive setting without rewriting or growing history", async () => {
  const user = await seedUser(db.admin);
  const baseline = await add(db.admin, user);
  await expect(asCoreRole(db.admin, "app_api", user, () => add(db.admin, user))).rejects.toMatchObject({ message: "RESIDENCE_TIME_ZONE_UNCHANGED" });
  expect((await db.admin.query('select * from "user".ledger_time_history where user_id=$1', [user])).rows).toEqual([baseline]);
});

it.each([1,2])("rejects a clock rollback after history revision %i without appending", async revision => {
  const user = await seedUser(db.admin);
  await add(db.admin, user);
  if (revision === 2) {
    // 빠른 DB에서도 준비 단계가 같은 밀리초에 겹치지 않도록 최초 이력만 과거로 둔다.
    // 이 시험은 아래 미래 revision 뒤의 역행 거부를 검증하며 실제 시계를 기다리지 않는다.
    await db.admin.query(`update "user".ledger_time_history
      set created_at=date_trunc('milliseconds',clock_timestamp()-interval '1 day','UTC')
      where user_id=$1 and revision=1`, [user]);
    await add(db.admin, user, "America/Los_Angeles");
  }
  // 테스트 owner만 과거 DB 시계가 현재보다 앞섰던 상태를 만든다. 런타임 UPDATE 권한은 없다.
  await db.admin.query(`with tick as materialized (select date_trunc('milliseconds',clock_timestamp()+interval '1 day','UTC') as value)
    update "user".ledger_time_history set created_at=tick.value,
    effective_from=case when revision=1 then null else tick.value end from tick
    where user_id=$1 and revision=$2`, [user, revision]);
  await expect(asCoreRole(db.admin, "app_api", user, () => add(db.admin, user, "UTC")))
    .rejects.toMatchObject({ message: "RESIDENCE_TIME_CLOCK_NOT_ADVANCED" });
  expect((await db.admin.query('select * from "user".ledger_time_history where user_id=$1', [user])).rowCount).toBe(revision);
});

it("enforces own active member scope and no-context denial", async () => {
  const owner = await seedUser(db.admin), other = await seedUser(db.admin);
  await add(db.admin, owner);
  await asCoreRole(db.admin, "app_api", other, async () => {
    expect((await db.admin.query('select * from "user".ledger_time_history')).rowCount).toBe(0);
  });
  for (const actor of [other, undefined])
    await expect(asCoreRole(db.admin, "app_api", actor, () => add(db.admin, owner, "UTC"))).rejects.toBeDefined();
  await db.admin.query('update "user".users set deleted_at=clock_timestamp() where user_id=$1', [owner]);
  await asCoreRole(db.admin, "app_api", owner, async () => {
    expect((await db.admin.query('select * from "user".ledger_time_history')).rowCount).toBe(0);
  });
  await expect(asCoreRole(db.admin, "app_api", owner, () => add(db.admin, owner, "UTC"))).rejects.toBeDefined();
});

it("denies client control of revision/clock, history edits/deletes and public role access", async () => {
  const user = await seedUser(db.admin);
  await add(db.admin, user);
  for (const sql of [
    'insert into "user".ledger_time_history(user_id,time_zone,revision) values($1,\'UTC\',9)',
    'insert into "user".ledger_time_history(user_id,time_zone,effective_from) values($1,\'UTC\',now())',
    'insert into "user".ledger_time_history(user_id,time_zone,created_at) values($1,\'UTC\',now())',
    'update "user".ledger_time_history set time_zone=\'UTC\' where user_id=$1',
    'delete from "user".ledger_time_history where user_id=$1',
  ]) await expect(asCoreRole(db.admin, "app_api", user, () => db.admin.query(sql, [user]))).rejects.toMatchObject({ code: "42501" });
  for (const role of ["app_session_bff", "anon", "authenticated", "service_role"] as const)
    await expect(asCoreRole(db.admin, role, user, () => db.admin.query('select * from "user".ledger_time_history'))).rejects.toMatchObject({ code: "42501" });
  const functions = (await db.admin.query("select proname,prosecdef,proconfig from pg_proc where oid in ('\"user\".guard_ledger_time_history()'::regprocedure,'finance.guard_transaction_time()'::regprocedure,'\"user\".is_ledger_time_zone(text)'::regprocedure)")).rows;
  expect(functions).toHaveLength(3);
  for (const f of functions) { expect(f.prosecdef).toBe(false); expect(f.proconfig).toContain('search_path=""'); }
});

it("serializes competing initial settings and releases the profile lock on rollback", async () => {
  const user = await seedUser(db.admin);
  const a = new Client({ connectionString: CORE_URL }), b = new Client({ connectionString: CORE_URL });
  await a.connect(); await b.connect();
  try {
    for (const client of [a,b]) {
      await client.query("set session authorization app_api; begin; set local statement_timeout='5s'");
      await client.query("select set_config('app.user_id',$1,true)", [user]);
    }
    expect((await add(a, user)).revision).toBe("1");
    const second = add(b, user, "UTC");
    await a.query("rollback");
    const only = await second;
    expect(only.revision).toBe("1"); expect(only.effective_from).toBeNull();
    await b.query("commit");
    expect((await db.admin.query('select time_zone from "user".ledger_time_history where user_id=$1', [user])).rows).toEqual([{ time_zone: "UTC" }]);
  } finally { await a.query("rollback"); await b.query("rollback"); await a.end(); await b.end(); }
});

it("serializes committed concurrent changes into distinct revisions", async () => {
  const user = await seedUser(db.admin);
  const a = new Client({ connectionString: CORE_URL }), b = new Client({ connectionString: CORE_URL });
  await a.connect(); await b.connect();
  try {
    for (const client of [a,b]) {
      await client.query("set session authorization app_api; begin; set local statement_timeout='5s'");
      await client.query("select set_config('app.user_id',$1,true)", [user]);
    }
    const first = await add(a, user);
    const second = add(b, user, "UTC");
    await a.query("commit");
    expect(first.revision).toBe("1"); expect((await second).revision).toBe("2");
    await b.query("commit");
  } finally { await a.query("rollback"); await b.query("rollback"); await a.end(); await b.end(); }
});
