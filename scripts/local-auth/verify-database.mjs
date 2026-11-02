import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { Client } = createRequire(join(root, "packages/database/package.json"))("pg");
const directory = join(process.env.LOCALAPPDATA, "account-book/dev-auth");
const passed = [];
let stage = "config";

/** @param {boolean} condition 검증 결과. @param {string} label 비밀값 없는 고정 검증 이름. */
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed.push(label);
}

/**
 * 실패해야 하는 SQL을 SAVEPOINT로 격리해 실제 역할의 거부를 확인합니다.
 * @param {import('pg').Client} client 실제 런타임 역할 연결.
 * @param {string} sql 테스트에서 고정한 SQL. 외부 입력은 넣지 않습니다.
 * @param {string} label 안전한 결과 이름.
 * @param {string} expected 기대 SQLSTATE; 기본은 권한 거부.
 */
async function denied(client, sql, label, expected = "42501") {
  await client.query("savepoint denied_probe");
  let code;
  try { await client.query(sql); } catch (error) { code = error.code; }
  await client.query("rollback to savepoint denied_probe");
  check(code === expected, label);
}

try {
  for (const kind of ["web", "api"]) {
    stage = `${kind}-connect`;
    const config = JSON.parse(readFileSync(join(directory, `${kind}.json`), "utf8"));
    const client = new Client({ connectionString: kind === "web" ? config.DATABASE_URL : config.API_DATABASE_URL, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
    client.on("error", () => {});
    try {
      await client.connect();
      check(client.connection.stream.authorized === true, `${kind}-tls-certificate`);
      await client.query("begin");
      const actual = (await client.query("select current_user, ssl from pg_stat_ssl where pid = pg_backend_pid()")).rows[0];
      check(actual.current_user === (kind === "web" ? "app_bff_login" : "app_api") && actual.ssl === true, `${kind}-identity-and-upstream-tls`);
      const flags = (await client.query("select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname=current_user")).rows[0];
      check(Object.values(flags).every((flag) => flag === false), `${kind}-no-elevated-attributes`);
      stage = `${kind}-permissions`;
      await denied(client, "set role postgres", `${kind}-cannot-become-owner`);
      await denied(client, "create table app_private.forbidden_probe (id integer)", `${kind}-cannot-create-table`);
      await denied(client, "select id from auth.users limit 0", `${kind}-cannot-read-provider-users`);
      if (kind === "web") {
        for (const table of ["auth_sessions", "oauth_transactions", "auth_recovery_transactions", "auth_rate_limits", "email_confirmation_transactions", "auth_user_security_state"]) {
          const grants = (await client.query("select has_table_privilege(current_user, $1, 'SELECT') and has_table_privilege(current_user, $1, 'INSERT') and has_table_privilege(current_user, $1, 'UPDATE') and has_table_privilege(current_user, $1, 'DELETE') as allowed, has_table_privilege(current_user, $1, 'TRUNCATE,REFERENCES,TRIGGER') as elevated", [`app_private.${table}`])).rows[0];
          check(grants.allowed === true && grants.elevated === false, `bff-${table}-limited-grant`);
          await client.query(`select 1 from app_private.${table} where false`);
        }
        const id = randomUUID();
        await client.query("insert into app_private.auth_user_security_state (user_id) values ($1)", [id]);
        await client.query("update app_private.auth_user_security_state set minimum_accepted_iat=1 where user_id=$1", [id]);
        check((await client.query("delete from app_private.auth_user_security_state where user_id=$1", [id])).rowCount === 1, "bff-write-update-delete-rollback-probe");
        await denied(client, "select * from app_private.api_jwt_replays limit 0", "bff-cannot-read-api-replays");
        await denied(client, "insert into app_private.api_jwt_replays (jti_digest,expires_at) values (decode(repeat('01',32),'hex'),now()+interval '1 minute')", "bff-cannot-write-api-replays");
        await denied(client, "set role app_api", "bff-cannot-assume-api");
      } else {
        const digest = randomBytes(32);
        await client.query("insert into app_private.api_jwt_replays (jti_digest,expires_at) values ($1,now()+interval '1 minute')", [digest]);
        passed.push("api-can-insert-replay");
        await denied(client, "select * from app_private.api_jwt_replays limit 0", "api-cannot-read-replays");
        await denied(client, "delete from app_private.api_jwt_replays where false", "api-cannot-delete-replays");
        for (const table of ["auth_sessions", "oauth_transactions", "auth_recovery_transactions", "auth_rate_limits", "email_confirmation_transactions", "auth_user_security_state"]) {
          await denied(client, `select 1 from app_private.${table} where false`, `api-cannot-read-${table}`);
        }
        await denied(client, "set role app_session_bff", "api-cannot-assume-bff");
      }
    } finally {
      await client.query("rollback").catch(() => {});
      await client.end().catch(() => {});
    }
  }
  console.log(JSON.stringify({ status: "passed", checks: passed.length, passed, writes: "rolled-back" }));
} catch {
  console.error(JSON.stringify({ status: "failed", stage, checksPassed: passed.length, lastPassed: passed.at(-1) }));
  process.exitCode = 1;
}
