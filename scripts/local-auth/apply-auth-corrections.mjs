import { X509Certificate, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { parseSetupUrl, PROJECT_REF } from "./config.mjs";
import { assertPrivateDirectory } from "./private-directory.mjs";
import { checkedSql } from "./core-migration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { Client } = createRequire(join(root, "packages/database/package.json"))("pg");
const migrations = [
  ["202610010001_auth_account_lookup.sql", "ef056a59c488fcbfc5483658954755da691ade9e5ba7d21e521aee55888ed199"],
  ["202610010002_oauth_signup_intent.sql", "a3ee87d1b1650a795b40148d90229146925d2ee7228f5554f2969e01fa733896"],
];
let client, committed = false, stage = "arguments";
/** @param {boolean} ok 검사 결과. 원문 SQL·자격 증명 대신 고정 단계만 보고한다. */
function check(ok) { if (!ok) throw new Error("AUTH_CORRECTIONS_CHECK_FAILED"); }

/**
 * 승인된 개발 DB에 두 additive migration을 하나의 트랜잭션으로 적용한다.
 * --check는 동일 검증 후 rollback, --apply는 검증 후 commit. 재실행/기존 개체 덮어쓰기는 거부한다.
 * 소유자 URI는 비공개 로컬 설정에서만 읽고 사용자 ID·이메일·비밀번호는 출력하지 않는다.
 */
async function main() {
  const command = process.argv.slice(2);
  check(command.length === 1 && ["--check", "--apply"].includes(command[0]));
  const directory = join(process.env.LOCALAPPDATA, "account-book/dev-auth");
  assertPrivateDirectory(directory);
  const owner = parseSetupUrl(parseEnv(readFileSync(join(process.env.TEMP, "account-book-supabase-setup.env"), "utf8")).MIGRATION_DATABASE_URL);
  const ca = readFileSync(join(directory, "supabase-ca.pem"), "utf8");
  const certificate = new X509Certificate(ca);
  check(certificate.ca && certificate.fingerprint256 === "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA" && Date.parse(certificate.validTo) > Date.now());
  const sql = migrations.map(([file, hash]) => checkedSql(readFileSync(join(root, "supabase/migrations", file), "utf8"), hash));
  stage = "connect";
  client = new Client({ host: owner.hostname, port: 5432, user: decodeURIComponent(owner.username), password: decodeURIComponent(owner.password), database: "postgres", ssl: { ca, rejectUnauthorized: true, servername: owner.hostname, minVersion: "TLSv1.2" }, connectionTimeoutMillis: 10000, query_timeout: 20000 });
  client.on("error", () => {});
  await client.connect();
  await client.query("begin");
  await client.query("set local lock_timeout='3s'; set local statement_timeout='15s'");
  await client.query("select pg_advisory_xact_lock(193829,20261001)");
  stage = "preflight";
  const identity = (await client.query("select current_user,current_database() as db,ssl from pg_stat_ssl where pid=pg_backend_pid()")).rows[0];
  check(identity.current_user === "postgres" && identity.db === "postgres" && identity.ssl && client.connection.stream.authorized);
  const state = (await client.query("select to_regprocedure('app_private.check_email_account(text,text,bytea,bytea)') is null as function_absent, not exists(select 1 from information_schema.columns where table_schema='app_private' and table_name='oauth_transactions' and column_name='intent') as column_absent")).rows[0];
  check(state.function_absent && state.column_absent);
  // 짧은 읽기 잠금으로 회원 행 보존 검증 중 동시 가입으로 생기는 오탐을 막는다.
  await client.query("lock table auth.users in share mode");
  const before = (await client.query("select md5(coalesce(string_agg(id::text,',' order by id),'')) as fingerprint from auth.users")).rows[0].fingerprint;
  for (let index=0; index<sql.length; index++) { stage = `migration-${index+1}`; await client.query(sql[index]); }
  stage = "verify-grants";
  for (const role of ["app_session_bff", "app_bff_login", "app_api", "anon", "authenticated", "service_role"]) {
    const access = (await client.query("select has_function_privilege($1,'app_private.check_email_account(text,text,bytea,bytea)','EXECUTE') as execute,has_table_privilege($1,'auth.users','SELECT') as read", [role])).rows[0];
    check(access.execute === ["app_session_bff", "app_bff_login"].includes(role));
    if (["app_session_bff", "app_bff_login", "app_api"].includes(role)) check(access.read === false);
  }
  const functionState = (await client.query("select prosecdef, proconfig from pg_proc where oid='app_private.check_email_account(text,text,bytea,bytea)'::regprocedure")).rows[0];
  check(functionState.prosecdef && functionState.proconfig.includes('search_path=""'));
  stage = "verify-data-and-probe";
  const after = (await client.query("select md5(coalesce(string_agg(id::text,',' order by id),'')) as fingerprint from auth.users")).rows[0].fingerprint;
  check(before === after);
  stage = "verify-legacy-intent";
  check((await client.query("select count(*)::int as n from app_private.oauth_transactions where intent is distinct from 'sign_in'")).rows[0].n === 0);
  check((await client.query("select is_nullable,column_default from information_schema.columns where table_schema='app_private' and table_name='oauth_transactions' and column_name='intent'")).rows[0].is_nullable === "NO");
  stage = "verify-owner-probe";
  // probe counter는 실제 예산을 소비하지 않도록 savepoint 단위로 되돌린다.
  await client.query("savepoint probe");
  check((await client.query("select app_private.check_email_account($1,'password_reset',$2,$3) as status", ["migration-check@example.invalid", randomBytes(32), randomBytes(32)])).rows[0].status === "absent");
  await client.query("rollback to savepoint probe");
  stage = "finish";
  await client.query(command[0] === "--apply" ? "commit" : "rollback");
  committed = command[0] === "--apply";
  if (committed) {
    // Supabase postgres에 역할 전환 권한을 추가하지 않고 실제 BFF 로그인으로 확인한다.
    stage = "verify-runtime-login";
    const config = JSON.parse(readFileSync(join(directory, "web.json"), "utf8"));
    const url = new URL(config.DATABASE_URL);
    check(url.hostname === owner.hostname && decodeURIComponent(url.username) === `app_bff_login.${PROJECT_REF}` && url.searchParams.get("sslmode") === "verify-full");
    const runtime = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 10000 });
    runtime.on("error", () => {});
    try {
      await runtime.connect();
      check(runtime.connection.stream.authorized === true);
      await runtime.query("begin");
      check((await runtime.query("select current_user")).rows[0].current_user === "app_bff_login");
      check((await runtime.query("select app_private.check_email_account($1,'password_reset',$2,$3) as status", ["migration-check@example.invalid", randomBytes(32), randomBytes(32)])).rows[0].status === "absent");
    } finally { await runtime.query("rollback").catch(() => {}); await runtime.end().catch(() => {}); }
  }
  console.log(JSON.stringify({ status: committed ? "applied" : "checked-and-rolled-back", projectRef: PROJECT_REF, migrations: migrations.map(([file, sha256]) => ({ file, sha256 })), usersPreserved: true, probeRolledBack: true, runtimeLoginVerified: committed }));
}
try { await main(); }
catch (error) {
  if (client && !committed) await client.query("rollback").catch(() => {});
  const sqlState = typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : undefined;
  const denied = ["schema app_private", "schema auth", "table users", "table auth_rate_limits", 'set role "app_session_bff"'].find((item) => error?.message?.includes(item));
  console.error(JSON.stringify({ status: "failed", stage, sqlState, denied, committed, note: "No raw provider/DB error is logged. Inspect; do not force retry." }));
  process.exitCode = 1;
} finally { if (client) await client.end().catch(() => {}); }
