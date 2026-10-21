import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXISTING_USER, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";

const names = [
  ["app_identity.profiles", '"user".users'],
  ["app_identity.user_roles", '"user".roles'],
  ["app_identity.role_change_events", '"user".role_history'],
  ["app_ledger.accounts", "finance.accounts"],
  ["app_ledger.categories", "finance.transaction_categories"],
  ["app_ledger.transactions", "finance.transaction_history"],
  ["app_ledger.transfers", "finance.account_transfers"],
  ["app_ledger.idempotency_requests", "finance.request_deduplication"],
] as const;
let db: CoreDatabase;
let migration: string;
type Snapshot = { oid: number; acl: unknown; rls: boolean; forced: boolean; rows: unknown[] };
const before: Snapshot[] = [];

/** @param relation 고정 테스트 테이블명. @returns 내용과 OID·ACL·RLS의 보존 비교용 snapshot. */
async function snapshot(relation: string): Promise<Snapshot> {
  const state = (await db.admin.query("select oid,relacl as acl,relrowsecurity as rls,relforcerowsecurity as forced from pg_class where oid=$1::regclass", [relation])).rows[0];
  const rows = (await db.admin.query(`select to_jsonb(t) as value from ${relation} t order by to_jsonb(t)::text`)).rows;
  return { ...state, rows };
}

beforeAll(async () => {
  db = await openCoreDatabase(process.env, false);
  await db.admin.query("update app_identity.profiles set nickname='보존할 이름' where user_id=$1", [EXISTING_USER]);
  await db.admin.query("update app_identity.user_roles set role='admin' where user_id=$1", [EXISTING_USER]);
  const account = (await db.admin.query("insert into app_ledger.accounts(user_id,kind,name) values($1,'bank','보존 계좌') returning id", [EXISTING_USER])).rows[0].id;
  const category = (await db.admin.query("insert into app_ledger.categories(user_id,kind,name) values($1,'expense','보존 분류') returning id", [EXISTING_USER])).rows[0].id;
  await db.admin.query("insert into app_ledger.transactions(user_id,account_id,category_id,kind,amount_krw,occurred_on,memo) values($1,$2,$3,'expense',12345,'2026-09-30','합성 테스트')", [EXISTING_USER, account, category]);
  await db.admin.query("insert into app_ledger.idempotency_requests(user_id,operation,idempotency_key,request_fingerprint,response_snapshot) values($1,'create_account',gen_random_uuid(),$2,$3)", [EXISTING_USER, Buffer.alloc(32), { id: account }]);
  const destination = (await db.admin.query("insert into app_ledger.accounts(user_id,kind,name) values($1,'cash','받는 계좌') returning id", [EXISTING_USER])).rows[0].id;
  await db.admin.query("begin");
  const transfer = (await db.admin.query("insert into app_ledger.transfers(user_id,from_account_id,to_account_id,amount_krw,occurred_on) values($1,$2,$3,1000,'2026-09-30') returning id", [EXISTING_USER, account, destination])).rows[0].id;
  await db.admin.query("insert into app_ledger.transactions(user_id,account_id,kind,amount_krw,occurred_on,transfer_id) values($1,$2,'transfer_out',1000,'2026-09-30',$4),($1,$3,'transfer_in',1000,'2026-09-30',$4)", [EXISTING_USER, account, destination, transfer]);
  await db.admin.query("commit");
  for (const [old] of names) before.push(await snapshot(old));
  migration = await readFile(new URL("../../supabase/migrations/202609300001_readable_schema_names.sql", import.meta.url), "utf8").catch(() => "");
  if (migration) await db.admin.query(migration);
});
afterAll(async () => { await db?.close(); });

describe.sequential("data-preserving core schema upgrade", () => {
  it("renames the eight existing tables, preserving object identity, every row and access policies", async () => {
    const tables = (await db.admin.query("select schemaname||'.'||tablename as name from pg_tables where schemaname in ('user','finance') order by name")).rows.map(r => r.name);
    expect(tables).toEqual(["finance.account_transfers", "finance.accounts", "finance.request_deduplication", "finance.transaction_categories", "finance.transaction_history", "user.role_history", "user.roles", "user.users"]);
    for (let index = 0; index < names.length; index++) expect(await snapshot(names[index]![1])).toEqual(before[index]);
    expect((await db.admin.query("select nspname from pg_namespace where nspname in ('app_identity','app_ledger')")).rows).toEqual([]);
  });
  it("keeps user isolation and schema grants while preserving a default-deny audit table", async () => {
    const access = (await db.admin.query(`select has_schema_privilege('app_api','user','USAGE') as api,
      has_schema_privilege('anon','user','USAGE') as anon,
      has_schema_privilege('app_session_bff','finance','USAGE') as bff,
      has_table_privilege('app_api','"user".role_history','SELECT') as audit`)).rows[0];
    expect(access).toEqual({ api: true, anon: false, bff: false, audit: false });
  });
  it("refuses reapplication without changing existing objects", async () => {
    await db.admin.query("begin");
    try { await expect(db.admin.query(migration)).rejects.toBeDefined(); }
    finally { await db.admin.query("rollback"); }
    for (let index = 0; index < names.length; index++) expect(await snapshot(names[index]![1])).toEqual(before[index]);
  });
  it("refuses a target namespace collision and rolls back without changing legacy data", async () => {
    // 실제 적용 후 DB와 독립된 기존 이름 상태에서 충돌을 재현한다.
    await db.close();
    db = await openCoreDatabase(process.env, false);
    const legacy = await snapshot("app_identity.profiles");
    await db.admin.query("begin");
    try {
      await db.admin.query('create schema "user"');
      await expect(db.admin.query(migration)).rejects.toMatchObject({ message: "SCHEMA_RENAME_STATE_INVALID" });
    } finally { await db.admin.query("rollback"); }
    expect(await snapshot("app_identity.profiles")).toEqual(legacy);
    expect((await db.admin.query("select to_regnamespace('user') as target")).rows).toEqual([{ target: null }]);
  });
});
