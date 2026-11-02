import * as schema from "@account-book/database";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asBankRole, openBankDatabase, type BankTestDatabase } from "./support/bank-database.js";

let database: BankTestDatabase;
beforeAll(async () => { database = await openBankDatabase(); });
afterAll(async () => { await database?.close(); });

describe("bank quota declarations and authority", () => {
  it("matches the quota declaration with the real catalog", async () => {
    const declaration = Reflect.get(schema, "bankRequestLimits");
    expect(declaration).toBeDefined();
    const config = getTableConfig(declaration);
    expect(config.name).toBe("bank_request_limits");
    const columns = (await database.admin.query("select attname as name,format_type(atttypid,atttypmod) as type,attnotnull as required from pg_attribute where attrelid='app_bank.bank_request_limits'::regclass and attnum>0 order by attnum")).rows;
    expect(columns).toEqual(config.columns.map((column) => ({ name: column.name, type: column.getSQLType(), required: column.notNull })));
    const keys = (await database.admin.query("select conname,contype from pg_constraint where conrelid='app_bank.bank_request_limits'::regclass order by conname")).rows;
    expect(keys).toEqual([...config.checks.map((check) => ({ conname: check.name, contype: "c" })), ...config.primaryKeys.map((key) => ({ conname: key.getName(), contype: "p" }))].sort((a, b) => a.conname.localeCompare(b.conname)));
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(["scope", "key_digest"]);
    expect(config.indexes.map((index) => index.config.name)).toEqual(["bank_limits_expiry_idx"]);
    expect((await database.admin.query("select indexname from pg_indexes where schemaname='app_bank' and tablename='bank_request_limits' and indexname<>'bank_request_limits_pkey'")).rows).toEqual([{ indexname: "bank_limits_expiry_idx" }]);
  });

  it("allows only two API wrappers and one maintenance entry point", async () => {
    for (const [signature, audience] of [["consume_start_limit()", "app_api"], ["consume_callback_limit(bytea)", "app_api"], ["consume_limit(text,bytea)", null], ["cleanup_requests(integer)", "app_bank_maintenance"]] as const) {
      for (const role of ["app_api", "app_bank_maintenance", "app_session_bff", "anon", "authenticated", "service_role"]) {
        expect((await database.admin.query("select has_function_privilege($1,$2,'EXECUTE') as ok", [role, `app_bank.${signature}`])).rows[0].ok).toBe(role === audience);
      }
      expect((await database.admin.query("select prosecdef,proconfig,pg_get_userbyid(proowner) as owner from pg_proc where oid=$1::regprocedure", [`app_bank.${signature}`])).rows[0]).toEqual({ prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"], owner: "app_bank_flow" });
    }
  });

  it("denies direct quota access and API cleanup/private helper calls", async () => {
    for (const role of ["app_api", "app_bank_maintenance", "app_session_bff", "anon", "authenticated", "service_role"]) {
      expect((await database.admin.query("select has_table_privilege($1,'app_bank.bank_request_limits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as ok", [role])).rows[0].ok).toBe(false);
    }
    for (const statement of ["select * from app_bank.bank_request_limits", "select * from app_bank.consume_limit('start',decode(repeat('01',32),'hex'))", "select * from app_bank.cleanup_requests()", "set role app_bank_maintenance"]) {
      await expect(asBankRole(database.admin, "app_api", undefined, () => database.admin.query(statement))).rejects.toMatchObject({ code: "42501" });
    }
    expect((await database.admin.query("select relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner)<>'app_bank_flow' as separate_owner from pg_class where oid='app_bank.bank_request_limits'::regclass")).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, separate_owner: true });
  });

  it("executes maintenance without granting direct tables or escalation", async () => {
    const role = (await database.admin.query("select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname='app_bank_maintenance'")).rows[0];
    expect(Object.values(role)).toEqual([false, false, false, false, false, false]);
    expect((await database.admin.query("select 1 from pg_auth_members where roleid='app_bank_maintenance'::regrole or member='app_bank_maintenance'::regrole")).rowCount).toBe(0);
    await database.admin.query("set session authorization app_bank_maintenance");
    try {
      expect((await database.admin.query("select * from app_bank.cleanup_requests()")).rows[0]).toEqual({ expired_requests: 0, removed_limits: 0 });
      await expect(database.admin.query("select * from app_bank.bank_connection_credentials")).rejects.toMatchObject({ code: "42501" });
    } finally { await database.admin.query("reset session authorization"); }
  });
});
