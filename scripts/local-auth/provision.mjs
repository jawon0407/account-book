import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { assertEmptySetup, createLocalAuthConfig, parseSetupUrl, PROJECT_REF } from "./config.mjs";
import { assertPrivateDirectory } from "./private-directory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { Client, escapeLiteral } = createRequire(join(root, "packages/database/package.json"))("pg");
const migrations = [
  ["202607200001_security_auth_foundation.sql", "f60e655369a5a73694ad426976c9c4fee8c49a4a9cda9d9127b7ce8254e3ea7e"],
  ["202607200002_server_pkce_transactions.sql", "523a3c83b173485be9e6f622f85ca42347b23af06cb38f9ab3900f940d687ee5"],
  ["202607200003_user_security_state.sql", "f89459436106461911bc88d82d5592bf52a2b71c314ef4cf2640d90d5a3a2e1f"],
  ["202607230001_delegated_jwt_replay.sql", "b99cea99e76a4aaab1978eeaf484d42fb4054c3a180559936ad85fab1592c221"],
];
let stage = "arguments";
let client;
let committed = false;

/**
 * 승인된 새 개발 프로젝트에만 인증 SQL을 원자적으로 적용합니다.
 * 비밀은 ACL이 제한된 사용자 로컬 디렉터리에 먼저 보존하고, stdout에는 단계/체크섬만 출력합니다.
 * @returns {Promise<void>} 완료 또는 고정된 실패 진단. 실패 시 재실행으로 덮어쓰지 않습니다.
 */
async function main() {
  const dryRun = process.argv[2] === "--check-new-development-only";
  if (process.platform !== "win32" || process.argv.length !== 3 || (!dryRun && process.argv[2] !== "--apply-new-development-only")) throw new Error("ARGUMENTS_INVALID");
  const privateDir = join(process.env.LOCALAPPDATA, "account-book/dev-auth");
  assertPrivateDirectory(privateDir);
  if (!dryRun) for (const name of ["web.json", "api.json", "applied.json"]) if (existsSync(join(privateDir, name))) throw new Error("EXISTING_CONFIG_REFUSED");
  const migrationUrl = parseEnv(readFileSync(join(process.env.TEMP, "account-book-supabase-setup.env"), "utf8")).MIGRATION_DATABASE_URL;
  const owner = parseSetupUrl(migrationUrl);
  const sqlFiles = migrations.map(([name, hash]) => {
    const sql = readFileSync(join(root, "supabase/migrations", name), "utf8");
    if (createHash("sha256").update(sql).digest("hex") !== hash) throw new Error("MIGRATION_CHECKSUM_MISMATCH");
    return sql;
  });
  stage = "ca";
  const response = await fetch("https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt", { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("CA_DOWNLOAD_FAILED");
  const ca = await response.text();
  const cert = new X509Certificate(ca);
  if (!cert.ca || cert.fingerprint256 !== "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA" || Date.parse(cert.validTo) <= Date.now()) throw new Error("CA_VALIDATION_FAILED");
  const caPath = join(privateDir, "supabase-ca.pem");
  stage = "connect";
  client = new Client({ host: owner.hostname, port: 5432, user: decodeURIComponent(owner.username), password: decodeURIComponent(owner.password), database: "postgres", ssl: { ca, rejectUnauthorized: true, minVersion: "TLSv1.2", servername: owner.hostname }, connectionTimeoutMillis: 10_000, query_timeout: 15_000, application_name: "account-book-dev-auth-provision" });
  client.on("error", () => {});
  await client.connect();
  await client.query("begin");
  await client.query("set local lock_timeout = '3s'; set local statement_timeout = '12s'");
  await client.query("select pg_advisory_xact_lock(193829, 20260929)");
  stage = "preflight";
  const info = (await client.query("select current_user, ssl from pg_stat_ssl where pid = pg_backend_pid()")).rows[0];
  const schemas = (await client.query("select nspname from pg_namespace where nspname in ('app_private', 'app_bank')")).rows.map((r) => r.nspname);
  const roles = (await client.query("select rolname from pg_roles where rolname in ('app_session_bff', 'app_bff_login', 'app_api')")).rows.map((r) => r.rolname);
  assertEmptySetup({ schemas, roles, currentUser: info?.current_user, clientTls: client.connection.stream.authorized, databaseTls: info?.ssl });
  stage = "persist-private-config";
  const publicConfig = parseEnv(readFileSync(join(root, "apps/web/.env.local"), "utf8"));
  if (publicConfig.SUPABASE_URL !== `https://${PROJECT_REF}.supabase.co`) throw new Error("PUBLIC_PROJECT_MISMATCH");
  const config = createLocalAuthConfig({ migrationUrl, caPath, publishableKey: publicConfig.SUPABASE_ANON_KEY });
  if (!dryRun) {
    writeFileSync(caPath, ca, { flag: "wx", mode: 0o600 });
    for (const kind of ["web", "api"]) writeFileSync(join(privateDir, `${kind}.json`), JSON.stringify(config[kind]), { flag: "wx", mode: 0o600 });
  }
  stage = "migrations";
  for (let index = 0; index < sqlFiles.length; index++) {
    stage = `migration-${index + 1}`;
    await client.query(sqlFiles[index]);
  }
  stage = "runtime-roles";
  await client.query("create role app_bff_login login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10");
  await client.query("grant app_session_bff to app_bff_login");
  for (const [role, url, limit] of [["app_bff_login", config.web.DATABASE_URL, 10], ["app_api", config.api.API_DATABASE_URL, 5]]) {
    const password = new URL(url).password;
    if (!/^[A-Za-z0-9_-]{43}$/u.test(password)) throw new Error("GENERATED_PASSWORD_INVALID");
    // 역할명은 위 고정 목록만 사용하고, 비밀번호는 pg의 SQL 문자열 이스케이프를 적용한다.
    await client.query(`alter role ${role} password ${escapeLiteral(password)} connection limit ${limit}`);
    await client.query(`alter role ${role} set statement_timeout = '8s'`);
    await client.query(`alter role ${role} set idle_in_transaction_session_timeout = '15s'`);
  }
  if (dryRun) {
    const tables = (await client.query("select count(*)::int as count from pg_tables where schemaname = 'app_private'")).rows[0].count;
    if (tables !== 7) throw new Error("TABLE_COUNT_INVALID");
    await client.query("rollback");
    console.log(JSON.stringify({ status: "check-passed-and-rolled-back", tables, nonSuperuserMigration: true }));
    return;
  }
  await client.query("commit");
  committed = true;
  stage = "receipt";
  const receipt = { projectRef: PROJECT_REF, appliedAt: new Date().toISOString(), migrations: migrations.map(([file, sha256]) => ({ file, sha256 })), appSchemasBefore: [], appRolesBefore: [], runtimeRoles: ["app_bff_login", "app_api"] };
  writeFileSync(join(privateDir, "applied.json"), JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: "applied", ...receipt }));
}

try { await main(); }
catch (error) {
  if (client && !committed) await client.query("rollback").catch(() => {});
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : "SETUP_FAILED";
  console.error(JSON.stringify({ status: "failed", stage, code, committed, note: "Do not overwrite config or retry blindly; inspect state first." }));
  process.exitCode = 1;
} finally { if (client) await client.end().catch(() => {}); }
