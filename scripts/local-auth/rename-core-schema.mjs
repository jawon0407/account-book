import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { parseSetupUrl, PROJECT_REF } from "./config.mjs";
import { assertPrivateDirectory } from "./private-directory.mjs";
import { checkedSql, coreCommand } from "./core-migration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { Client } = createRequire(join(root, "packages/database/package.json"))("pg");
const file = "202609300001_readable_schema_names.sql";
const sha256 = "801f462d4af033756de770590f1c8eca3ef6e70530f39d75eb5dcc54610192e5";
const names = [
  ["app_identity.profiles", '"user".users'], ["app_identity.user_roles", '"user".roles'],
  ["app_identity.role_change_events", '"user".role_history'], ["app_ledger.accounts", "finance.accounts"],
  ["app_ledger.categories", "finance.transaction_categories"], ["app_ledger.transactions", "finance.transaction_history"],
  ["app_ledger.transfers", "finance.account_transfers"], ["app_ledger.idempotency_requests", "finance.request_deduplication"],
];
let client, committed = false, stage = "arguments";
/** @param {boolean} ok 불변 조건. @param {string} code 민감 정보를 포함하지 않는 고정 오류명. */
function check(ok, code) { if (!ok) throw new Error(code); }

/** @param {0|1} version 기존/변경 후 이름. @returns {Promise<object>} 출력하지 않는 데이터·보안 보존 지문. */
async function snapshot(version) {
  const tables = [];
  for (const pair of names) {
    const relation = pair[version];
    const metadata = (await client.query(`select oid,relowner,relacl,relrowsecurity,relforcerowsecurity,
      (select jsonb_agg(jsonb_build_array(attnum,attacl) order by attnum) from pg_attribute where attrelid=c.oid and attnum>0) as columns
      from pg_class c where oid=$1::regclass`, [relation])).rows[0];
    check(metadata?.relrowsecurity && metadata.relforcerowsecurity, "RENAME_RLS_INVALID");
    const data = (await client.query(`select count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,',' order by to_jsonb(t)::text),'')) as hash from ${relation} t`)).rows[0];
    tables.push({ ...metadata, ...data });
  }
  const schemas = version ? ["user", "finance"] : ["app_identity", "app_ledger"];
  const namespace = (await client.query("select oid,nspowner,nspacl from pg_namespace where nspname=any($1) order by oid", [schemas])).rows;
  const functions = (await client.query("select p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) order by p.oid", [schemas])).rows;
  const auth = (await client.query("select count(*)::int as count,md5(coalesce(string_agg(id::text,',' order by id),'')) as hash from auth.users")).rows[0];
  return { tables, namespace, functions, auth };
}

/** @param {string} directory 비밀 경로. @param {string} host 승인 풀러. @param {string|undefined} userId 출력하지 않는 본인 ID. */
async function verifyRuntime(directory, host, userId) {
  let checks = 0;
  for (const kind of ["api", "web"]) {
    const config = JSON.parse(readFileSync(join(directory, `${kind}.json`), "utf8"));
    const connectionString = kind === "api" ? config.API_DATABASE_URL : config.DATABASE_URL;
    const url = new URL(connectionString), role = kind === "api" ? "app_api" : "app_bff_login";
    check(url.hostname === host && decodeURIComponent(url.username) === `${role}.${PROJECT_REF}` && url.searchParams.get("sslmode") === "verify-full", "RENAME_RUNTIME_TARGET_INVALID");
    const runtime = new Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 10000 });
    runtime.on("error", () => {});
    try {
      await runtime.connect(); await runtime.query("begin read only");
      const who = (await runtime.query("select current_user,ssl from pg_stat_ssl where pid=pg_backend_pid()")).rows[0];
      check(who.current_user === role && who.ssl && runtime.connection.stream.authorized === true, "RENAME_RUNTIME_TLS_INVALID"); checks++;
      if (kind === "api") {
        for (const [, table] of names.filter(([, table]) => table !== '"user".role_history')) {
          check((await runtime.query(`select count(*)::int as count from ${table}`)).rows[0].count === 0, "RENAME_CONTEXT_LEAK"); checks++;
        }
        if (userId) {
          await runtime.query("select set_config('app.user_id',$1,true)", [userId]);
          check((await runtime.query('select "user".is_active_user() as active')).rows[0].active === true, "RENAME_ACTIVE_USER_FAILED"); checks++;
          check((await runtime.query('select count(*)::int as count from "user".users p join "user".roles r using(user_id) where p.user_id=$1', [userId])).rows[0].count === 1, "RENAME_PROFILE_FAILED"); checks++;
        }
      } else {
        for (const [, table] of names) {
          await runtime.query("savepoint denied_read"); let code;
          try { await runtime.query(`select 1 from ${table} limit 0`); } catch (error) { code = error.code; }
          await runtime.query("rollback to savepoint denied_read");
          check(code === "42501", "RENAME_BFF_ACCESS_ALLOWED"); checks++;
        }
      }
    } finally { await runtime.query("rollback").catch(() => {}); await runtime.end().catch(() => {}); }
  }
  return checks;
}

/** 승인된 개발 DB만 검사/rollback rehearsal/적용한다. 원문 SQL 오류나 비밀값은 출력하지 않는다. */
async function main() {
  const command = coreCommand(process.argv.slice(2));
  check(process.platform === "win32", "RENAME_PLATFORM_INVALID");
  const directory = join(process.env.LOCALAPPDATA, "account-book/dev-auth");
  assertPrivateDirectory(directory);
  const receipt = join(directory, "schema-rename-applied.json");
  if (command === "--apply") check(!existsSync(receipt), "RENAME_RECEIPT_EXISTS");
  const owner = parseSetupUrl(parseEnv(readFileSync(join(process.env.TEMP, "account-book-supabase-setup.env"), "utf8")).MIGRATION_DATABASE_URL);
  const ca = readFileSync(join(directory, "supabase-ca.pem"), "utf8"), cert = new X509Certificate(ca);
  check(cert.ca && cert.fingerprint256 === "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA" && Date.parse(cert.validTo) > Date.now(), "RENAME_CA_INVALID");
  const sql = checkedSql(readFileSync(join(root, "supabase/migrations", file), "utf8"), sha256);
  stage = "connect";
  client = new Client({ host: owner.hostname, port: 5432, user: decodeURIComponent(owner.username), password: decodeURIComponent(owner.password), database: "postgres", ssl: { ca, rejectUnauthorized: true, servername: owner.hostname, minVersion: "TLSv1.2" }, connectionTimeoutMillis: 10000, query_timeout: 20000, application_name: "account-book-schema-rename" });
  client.on("error", () => {}); await client.connect();
  await client.query(command === "--inspect" ? "begin read only" : "begin");
  await client.query("set local lock_timeout='3s'; set local statement_timeout='15s'");
  const who = (await client.query("select current_user,current_database() as database,ssl from pg_stat_ssl where pid=pg_backend_pid()")).rows[0];
  check(who.current_user === "postgres" && who.database === "postgres" && who.ssl && client.connection.stream.authorized === true, "RENAME_OWNER_TLS_INVALID");
  const tables = (await client.query("select schemaname,tablename from pg_tables where schemaname in ('app_identity','app_ledger','user','finance') order by schemaname,tablename")).rows;
  if (command === "--inspect") {
    const renamed = tables.length === 8 && tables.every(t => ["user", "finance"].includes(t.schemaname));
    const userId = renamed ? (await client.query('select user_id from "user".users where deleted_at is null order by user_id limit 1')).rows[0]?.user_id : undefined;
    await client.query("rollback");
    const runtimeChecks = renamed ? await verifyRuntime(directory, owner.hostname, userId) : 0;
    console.log(JSON.stringify({ status: "inspected", projectRef: PROJECT_REF, tables, runtimeChecks })); return;
  }
  stage = "preflight";
  check(tables.length === 8 && tables.every(t => ["app_identity", "app_ledger"].includes(t.schemaname)), "RENAME_PREFLIGHT_REFUSED");
  await client.query("select pg_advisory_xact_lock(193829,20260930)");
  // 모든 hash를 같은 쓰기 차단 구간에서 계산한다. 실제 행 값은 가져오지 않는다.
  await client.query("lock table auth.users in share row exclusive mode");
  await client.query(`lock table ${names.map(([old]) => old).join(",")} in access exclusive mode`);
  const before = await snapshot(0);
  stage = "rename"; await client.query(sql);
  stage = "verify-preservation";
  check(JSON.stringify(before) === JSON.stringify(await snapshot(1)), "RENAME_PRESERVATION_FAILED");
  check((await client.query("select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('user','finance') and (p.prosrc like '%app_identity.%' or p.prosrc like '%app_ledger.%')")).rows[0].count === 0, "RENAME_STALE_FUNCTION");
  if (command === "--check") { await client.query("rollback"); console.log(JSON.stringify({ status: "checked-and-rolled-back", dataAndSecurityPreserved: true })); return; }
  const userId = (await client.query('select user_id from "user".users where deleted_at is null order by user_id limit 1')).rows[0]?.user_id;
  await client.query("commit"); committed = true; stage = "receipt";
  const result = { projectRef: PROJECT_REF, appliedAt: new Date().toISOString(), file, sha256, dataAndSecurityPreserved: true };
  writeFileSync(receipt, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
  stage = "verify-runtime";
  const runtimeChecks = await verifyRuntime(directory, owner.hostname, userId);
  console.log(JSON.stringify({ status: "applied", runtimeChecks, ...result }));
}
try { await main(); }
catch (error) {
  if (client && !committed) await client.query("rollback").catch(() => {});
  const code = /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : /^(RENAME|CORE|LOCAL_AUTH)_[A-Z_]+$/u.test(error?.message ?? "") ? error.message : "RENAME_FAILED";
  console.error(JSON.stringify({ status: "failed", stage, code, committed, note: "Inspect state; no blind retry." })); process.exitCode = 1;
} finally { if (client) await client.end().catch(() => {}); }
