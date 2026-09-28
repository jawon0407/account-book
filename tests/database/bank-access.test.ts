import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asBankRole, openBankDatabase, type BankTestDatabase, type BankTestRole } from "./support/bank-database.js";
import { seedConnection, seedCredentials, seedRequest, USER_A, USER_B } from "./support/bank-fixtures.js";

const tables = ["bank_connections", "bank_connection_requests", "bank_connection_credentials"] as const;
let database: BankTestDatabase;
beforeAll(async () => {
  database = await openBankDatabase();
  for (const user of [USER_A, USER_B]) {
    await seedCredentials(database.admin, await seedConnection(database.admin, user), user);
    await seedRequest(database.admin, { user_id: user });
  }
});
afterAll(async () => { await database?.close(); });

describe("bank least-privilege access on disposable PostgreSQL", () => {
  it("refuses to replace an existing test database", async () => {
    await expect(openBankDatabase()).rejects.toThrow("BANK_TEST_DATABASE_ALREADY_EXISTS");
    expect((await database.admin.query("select * from app_bank.bank_connections")).rowCount).toBe(2);
  });

  it("rejects non-disposable or wrong database settings before connecting", async () => {
    for (const environment of [{}, { TEST_DATABASE_DISPOSABLE: "true", TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/not_bank_test" }, { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL }]) {
      await expect(openBankDatabase(environment)).rejects.toThrow("BANK_TEST_DATABASE_CONFIGURATION_INVALID");
    }
  });

  it.each([USER_A, USER_B, undefined, ""])("restricts app_api rows for context %s", async (user) => {
    await asBankRole(database.admin, "app_api", user, async () => {
      for (const table of tables) {
        const result = await database.admin.query(`select distinct user_id from app_bank.${table}`);
        expect(result.rows).toEqual(user ? [{ user_id: user }] : []);
      }
    });
  });

  it("does not leak transaction-local identity to the next transaction", async () => {
    await asBankRole(database.admin, "app_api", USER_A, async () => {
      expect((await database.admin.query("select * from app_bank.bank_connections")).rowCount).toBe(1);
    });
    await asBankRole(database.admin, "app_api", undefined, async () => {
      expect((await database.admin.query("select * from app_bank.bank_connections")).rowCount).toBe(0);
    });
  });

  it("fails closed for malformed user context", async () => {
    await expect(asBankRole(database.admin, "app_api", "not-a-uuid", () => database.admin.query("select * from app_bank.bank_connections"))).rejects.toMatchObject({ code: "22P02" });
  });

  it.each(["app_session_bff", "anon", "authenticated", "service_role"] as const)("denies bank schema to %s", async (role: BankTestRole) => {
    for (const table of tables) {
      await expect(asBankRole(database.admin, role, USER_A, () => database.admin.query(`select * from app_bank.${table}`))).rejects.toMatchObject({ code: "42501" });
    }
  });

  it.each([
    "delete from app_bank.bank_connections", "update app_bank.bank_connections set status='revoked'",
    "insert into app_bank.bank_connections default values", "truncate app_bank.bank_connections",
    "create table app_bank.forbidden(id int)", "alter table app_bank.bank_connections disable row level security",
    "set role postgres", "set role app_session_bff", "select app_bank.valid_token_envelope('{}')",
  ])("denies app_api operation %s", async (query) => {
    await expect(asBankRole(database.admin, "app_api", USER_A, () => database.admin.query(query))).rejects.toMatchObject({ code: "42501" });
  });

  it("enforces RLS on every table without owner or bypass privileges", async () => {
    const result = await database.admin.query(`select relname,relrowsecurity,relforcerowsecurity,
      pg_get_userbyid(relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_bank' and c.relkind='r'`);
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
      expect(row.owner).not.toBe("app_api");
    }
    const role = await database.admin.query("select rolsuper,rolbypassrls,rolcreaterole,rolcreatedb from pg_roles where rolname='app_api'");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    for (const table of tables) {
      for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        expect((await database.admin.query("select has_table_privilege('app_api',$1,$2) as allowed", [`app_bank.${table}`, privilege])).rows[0].allowed).toBe(false);
      }
    }
  });

  it("does not grant future tables to runtime or public roles", async () => {
    await database.admin.query("create table app_bank.future_probe(id int)");
    for (const role of ["app_api", "app_session_bff", "anon", "authenticated", "service_role"] as const) {
      await expect(asBankRole(database.admin, role, USER_A, () => database.admin.query("select * from app_bank.future_probe"))).rejects.toMatchObject({ code: "42501" });
    }
    await database.admin.query("drop table app_bank.future_probe");
  });
});
