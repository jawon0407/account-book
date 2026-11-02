import { X509Certificate } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { parseSetupUrl, PROJECT_REF } from "./config.mjs";
import { assertPrivateDirectory } from "./private-directory.mjs";
import { assertCoreAccess, assertCorePreflight, checkedSql, coreCommand, coreMigrations } from "./core-migration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { Client } = createRequire(join(root, "packages/database/package.json"))("pg");
let client, stage = "arguments", committed = false;

/** @param {boolean} ok 검사 결과. @param {string} code 고정 오류명. 개인 데이터/SQL 오류 원문을 반사하지 않는다. */
function requireCheck(ok, code) { if (!ok) throw new Error(code); }

/**
 * 역할을 흉내 내지 않고 실제 런타임 로그인으로 읽기 권한을 검사한다. 쓰기/가입 요청은 없다.
 * @param {string} directory 기존 비밀 디렉터리. @param {string} host 승인된 풀러 호스트.
 * @param {string|undefined} userId 기존 Auth에서 읽은 합성 아닌 실제 ID; 메모리에서만 사용하고 출력하지 않는다.
 * @returns {Promise<number>} 통과한 읽기 전용 검사 수.
 */
async function verifyRuntime(directory, host, userId) {
  let checks=0;
  for (const kind of ["api","web"]) {
    const config=JSON.parse(readFileSync(join(directory,`${kind}.json`),"utf8"));
    const connectionString=kind==="api"?config.API_DATABASE_URL:config.DATABASE_URL;
    const url=new URL(connectionString), role=kind==="api"?"app_api":"app_bff_login";
    requireCheck(url.hostname===host && decodeURIComponent(url.username)===`${role}.${PROJECT_REF}` && url.searchParams.get("sslmode")==="verify-full","CORE_RUNTIME_TARGET_INVALID");
    const runtime=new Client({connectionString,connectionTimeoutMillis:10000,query_timeout:10000});
    runtime.on("error",()=>{});
    try {
      await runtime.connect(); await runtime.query("begin read only");
      const who=(await runtime.query("select current_user,ssl from pg_stat_ssl where pid=pg_backend_pid()")).rows[0];
      requireCheck(who.current_user===role && who.ssl===true && runtime.connection.stream.authorized===true,"CORE_RUNTIME_IDENTITY_TLS_INVALID"); checks++;
      if(kind==="api") {
        for(const table of ["app_identity.profiles","app_identity.user_roles","app_ledger.accounts","app_ledger.categories","app_ledger.transactions","app_ledger.transfers","app_ledger.idempotency_requests"]) {
          requireCheck((await runtime.query(`select count(*)::int as count from ${table}`)).rows[0].count===0,"CORE_UNSET_USER_VISIBLE"); checks++;
        }
        if(userId) {
          await runtime.query("select set_config('app.user_id',$1,true)",[userId]);
          requireCheck((await runtime.query("select count(*)::int as count from app_identity.profiles where user_id=$1",[userId])).rows[0].count===1,"CORE_OWN_PROFILE_MISSING"); checks++;
          requireCheck((await runtime.query("select count(*)::int as count from app_identity.user_roles where user_id=$1",[userId])).rows[0].count===1,"CORE_OWN_ROLE_MISSING"); checks++;
        }
      } else {
        for(const table of ["app_identity.profiles","app_ledger.accounts"]) {
          await runtime.query("savepoint denied_read"); let code;
          try { await runtime.query(`select 1 from ${table} limit 0`); } catch(error) {code=error.code;}
          await runtime.query("rollback to savepoint denied_read");
          requireCheck(code==="42501","CORE_BFF_ACCESS_ALLOWED"); checks++;
        }
      }
    } finally { await runtime.query("rollback").catch(()=>{}); await runtime.end().catch(()=>{}); }
  }
  return checks;
}

/**
 * 기존 승인 개발 프로젝트에 신규 8개 테이블만 원자적으로 추가한다.
 * --inspect: 읽기 전용, --check: 적용 후 rollback, --apply: 검증 후 commit.
 * 비밀 입력은 기존 로컬 파일에서만 읽으며 stdout에는 메타데이터·검증 결과만 출력한다.
 */
async function main() {
  const command = coreCommand(process.argv.slice(2));
  requireCheck(process.platform === "win32", "WINDOWS_REQUIRED");
  const directory = join(process.env.LOCALAPPDATA, "account-book/dev-auth");
  assertPrivateDirectory(directory);
  const receiptPath = join(directory, "core-applied.json");
  if (command === "--apply") requireCheck(!existsSync(receiptPath), "CORE_RECEIPT_EXISTS");
  const owner = parseSetupUrl(parseEnv(readFileSync(join(process.env.TEMP, "account-book-supabase-setup.env"), "utf8")).MIGRATION_DATABASE_URL);
  const ca = readFileSync(join(directory, "supabase-ca.pem"), "utf8");
  const cert = new X509Certificate(ca);
  requireCheck(cert.ca && cert.fingerprint256 === "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA" && Date.parse(cert.validTo) > Date.now(), "CORE_CA_INVALID");
  const sqlFiles = coreMigrations.map(([file,hash]) => checkedSql(readFileSync(join(root,"supabase/migrations",file),"utf8"),hash));
  stage = "connect";
  client = new Client({ host: owner.hostname, port: 5432, user: decodeURIComponent(owner.username), password: decodeURIComponent(owner.password), database: "postgres", ssl: { ca, rejectUnauthorized: true, servername: owner.hostname, minVersion: "TLSv1.2" }, connectionTimeoutMillis: 10000, query_timeout: 20000, application_name: "account-book-core-schema" });
  client.on("error", () => {});
  await client.connect();
  await client.query(command === "--inspect" ? "begin read only" : "begin");
  await client.query("set local lock_timeout='3s'; set local statement_timeout='15s'");
  if (command !== "--inspect") await client.query("select pg_advisory_xact_lock(193829,20260930)");
  stage = "preflight";
  const who = (await client.query("select current_user,current_database() as database,ssl from pg_stat_ssl where pid=pg_backend_pid()")).rows[0];
  const roles = (await client.query("select rolname,rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication or pg_has_role(oid,'postgres','MEMBER') as unsafe from pg_roles where rolname in ('app_api','app_session_bff','app_bff_login')")).rows;
  const state = {
    currentUser: who.current_user, database: who.database, clientTls: client.connection.stream.authorized === true, databaseTls: who.ssl,
    schemas: (await client.query("select nspname from pg_namespace where nspname in ('app_identity','app_ledger')")).rows.map(r=>r.nspname),
    authReady: (await client.query("select count(*)::int as count from information_schema.columns where table_schema='auth' and table_name='users' and column_name in ('id','raw_app_meta_data')")).rows[0].count === 2,
    privateTables: (await client.query("select count(*)::int as count from pg_tables where schemaname='app_private'")).rows[0].count,
    bootstrapExists: (await client.query("select exists(select 1 from pg_trigger where tgname='account_book_user_bootstrap' and tgrelid='auth.users'::regclass) as present")).rows[0].present,
    rolesPresent: roles.length === 3, rolesSafe: roles.every(r=>r.unsafe === false),
    canAssumeApi: (await client.query("select pg_has_role(current_user,'app_api','SET') as allowed")).rows[0].allowed,
  };
  if (command === "--inspect") { await client.query("rollback"); console.log(JSON.stringify({ status: "inspected", projectRef: PROJECT_REF, ...state })); return; }
  assertCorePreflight(state);
  // 가입과 초기화 사이의 레이스를 막는 짧은 잠금. 대기 3초를 넘기면 중단하고 재검토한다.
  await client.query("lock table auth.users in share row exclusive mode");
  const before = (await client.query("select count(*)::int as count,md5(coalesce(string_agg(id::text,',' order by id),'')) as fingerprint from auth.users")).rows[0];
  const sampleUser=(await client.query("select id from auth.users order by id limit 1")).rows[0]?.id;
  for (let i=0;i<sqlFiles.length;i++) { stage = `migration-${i+1}`; await client.query(sqlFiles[i]); }
  stage = "verify-in-transaction";
  const after = (await client.query("select count(*)::int as count,md5(coalesce(string_agg(id::text,',' order by id),'')) as fingerprint from auth.users")).rows[0];
  requireCheck(before.count === after.count && before.fingerprint === after.fingerprint,"CORE_USERS_CHANGED");
  const tables = (await client.query("select n.nspname as schema,c.relname as table,c.relrowsecurity as rls,c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app_identity','app_ledger') and c.relkind='r' order by n.nspname,c.relname")).rows;
  requireCheck(tables.length===8 && tables.every(t=>t.rls && t.forced),"CORE_TABLES_INVALID");
  requireCheck((await client.query("select count(*)::int as count from auth.users u join app_identity.profiles p on p.user_id=u.id join app_identity.user_roles r on r.user_id=u.id where r.role='member'")).rows[0].count===before.count,"CORE_BACKFILL_INVALID");
  for (const role of ["anon","authenticated","service_role","app_session_bff","app_bff_login"]) {
    requireCheck((await client.query("select not has_schema_privilege($1,'app_identity','USAGE') and not has_schema_privilege($1,'app_ledger','USAGE') as denied",[role])).rows[0].denied,"CORE_PUBLIC_ACCESS");
  }
  stage = "verify-runtime-grants";
  const access=(await client.query(`select
    has_table_privilege('app_api','app_identity.profiles','SELECT') as "profileRead",
    has_column_privilege('app_api','app_identity.profiles','nickname','UPDATE') as "nicknameUpdate",
    has_table_privilege('app_api','app_identity.user_roles','SELECT') as "roleRead",
    has_column_privilege('app_api','app_identity.profiles','signup_provider','UPDATE') as "providerUpdate",
    has_column_privilege('app_api','app_identity.profiles','deleted_at','UPDATE') as "deletionUpdate",
    has_any_column_privilege('app_api','app_identity.user_roles','UPDATE') as "roleUpdate",
    has_table_privilege('app_api','app_identity.role_change_events','SELECT') as "auditRead",
    has_any_column_privilege('app_api','app_ledger.transfers','UPDATE') as "transferUpdate",
    bool_and(has_table_privilege('app_api',t,'SELECT')) as "ledgerRead",
    bool_or(has_table_privilege('app_api',t,'DELETE')) as "ledgerDelete"
    from unnest(array['app_ledger.accounts','app_ledger.categories','app_ledger.transactions','app_ledger.transfers','app_ledger.idempotency_requests']) t`)).rows[0];
  assertCoreAccess(access);
  if (command === "--check") { await client.query("rollback"); console.log(JSON.stringify({ status: "checked-and-rolled-back", tables, usersPreserved: true, backfilledUsers: before.count })); return; }
  await client.query("commit"); committed = true;
  stage = "receipt";
  const receipt = { projectRef: PROJECT_REF, appliedAt: new Date().toISOString(), migrations: coreMigrations.map(([file,sha256])=>({file,sha256})), tables, usersPreserved: true, backfilledUsers: before.count };
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{flag:"wx",mode:0o600});
  stage="verify-real-runtime-logins";
  const runtimeChecks=await verifyRuntime(directory,owner.hostname,sampleUser);
  console.log(JSON.stringify({status:"applied",runtimeChecks,...receipt}));
}
try { await main(); }
catch (error) {
  if (client && !committed) await client.query("rollback").catch(()=>{});
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : /^CORE_[A-Z_]+$/u.test(error?.message ?? "") ? error.message : "CORE_SETUP_FAILED";
  console.error(JSON.stringify({status:"failed",stage,code,committed,note:"Inspect state; do not force or blindly retry."})); process.exitCode=1;
} finally { if(client) await client.end().catch(()=>{}); }
