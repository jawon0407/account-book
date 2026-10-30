import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCoreDatabase, type CoreDatabase } from "./support/core-database.js";

let database: CoreDatabase;
beforeAll(async () => {
  database = await openCoreDatabase();
  await database.admin.query("alter table auth.users add column email text");
  await database.admin.query("update auth.users set email='member@example.test'");
  const sql = await readFile(new URL("../../supabase/migrations/202610010001_auth_account_lookup.sql", import.meta.url), "utf8").catch(() => "");
  if (sql) await database.admin.query(sql);
});
afterAll(async () => { await database?.close(); });

/** @param role 테스트에서 고정한 역할. @param work 역할별 검사. 항상 rollback한다. */
async function asRole(role: string, work: () => Promise<void>) {
  await database.admin.query(`set session authorization ${role}`);
  try { await database.admin.query("begin"); await work(); }
  finally { await database.admin.query("rollback"); await database.admin.query("reset session authorization"); }
}

/** @param email 합성 이메일. @param emailHash 이메일 HMAC 대역. @param browserHash 브라우저 HMAC 대역. */
async function lookup(email: string, emailHash = randomBytes(32), browserHash = randomBytes(32), kind = "sign_up") {
  return (await database.admin.query("select app_private.check_email_account($1,$2,$3,$4) as status", [email, kind, emailHash, browserHash])).rows[0].status;
}

describe("BFF-only account status and atomic rate budgets", () => {
  it("returns only presence, accepts normalized email, and denies direct auth table reads", async () => {
    await asRole("app_session_bff", async () => {
      expect(await lookup("MEMBER@example.test")).toBe("present");
      expect(await lookup("absent@example.test")).toBe("absent");
      await expect(database.admin.query("select email from auth.users")).rejects.toMatchObject({ code: "42501" });
    });
  });
  it.each(["anon", "authenticated", "service_role", "app_api"])("denies %s both lookup and identities", async (role) => {
    await asRole(role, async () => {
      await expect(lookup("member@example.test")).rejects.toMatchObject({ code: "42501" });
    });
  });
  it("limits the same email across different browsers to five requests per window", async () => {
    await asRole("app_session_bff", async () => {
      const emailHash = randomBytes(32);
      for (let index=0; index<5; index++) expect(await lookup("absent@example.test", emailHash)).toBe("absent");
      expect(await lookup("absent@example.test", emailHash)).toBe("rate_limited");
    });
  });
  it("limits one browser across different emails to twenty requests", async () => {
    await asRole("app_session_bff", async () => {
      const browser = randomBytes(32);
      for (let index=0; index<20; index++) expect(await lookup(`absent${index}@example.test`, randomBytes(32), browser)).toBe("absent");
      expect(await lookup("extra@example.test", randomBytes(32), browser)).toBe("rate_limited");
    });
  });
  it("limits distributed lookup with a global fixed budget", async () => {
    await asRole("app_session_bff", async () => {
      for (let index=0; index<120; index++) expect(await lookup(`absent${index}@example.test`)).toBe("absent");
      expect(await lookup("extra@example.test")).toBe("rate_limited");
    });
  });
  it("rejects bad lookup kinds without SQL injection", async () => {
    await asRole("app_session_bff", async () => {
      await expect(lookup("member@example.test", randomBytes(32), randomBytes(32), "other")).rejects.toMatchObject({ code: "22023" });
    });
  });
  it("pins empty search path and revokes PUBLIC execute", async () => {
    const row = (await database.admin.query("select prosecdef, proconfig, has_function_privilege('anon','app_private.check_email_account(text,text,bytea,bytea)','EXECUTE') as anon from pg_proc where oid='app_private.check_email_account(text,text,bytea,bytea)'::regprocedure")).rows[0];
    expect(row).toMatchObject({ prosecdef: true, anon: false });
    expect(row.proconfig).toContain('search_path=""');
  });
});
