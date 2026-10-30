import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asBankRole, openBankDatabase, type BankTestDatabase } from "./support/bank-database.js";
import { ENVELOPE } from "./support/bank-fixtures.js";
import { claimFlow, endFlow, finishFlow, flowCall, flowInput, flowRow, readyFlow, startFlow } from "./support/bank-flow.js";

let database: BankTestDatabase;
let first: Client;
let second: Client;
beforeAll(async () => {
  database = await openBankDatabase();
  first = await database.connect();
  second = await database.connect();
});
afterAll(async () => { await database?.close(); });

describe("independent PostgreSQL connection races", () => {
  it("serializes two starts into exactly one active wait", async () => {
    const a = flowInput();
    const b = { ...flowInput(), session: a.session };
    await Promise.all([startFlow(first, a), startFlow(second, b)]);
    const rows = await database.admin.query("select status from app_bank.bank_connection_requests where session_id=$1 order by status", [a.session]);
    expect(rows.rows).toEqual([{ status: "awaiting_callback" }, { status: "cancelled" }]);
  });

  it("accepts only one competing callback without overwriting the winning code", async () => {
    const a = flowInput();
    await startFlow(database.admin, a);
    const codes = [ENVELOPE, { ...ENVELOPE, kid: "second" }];
    const results = await Promise.all([first, second].map((db, index) => flowCall(db, null, () => db.query("select app_bank.receive_callback($1,$2,false) as id", [a.state, codes[index]]))));
    const winner = results.findIndex((result) => result.rows[0].id === a.id);
    expect(results.filter((result) => result.rows[0].id === a.id)).toHaveLength(1);
    expect((await flowRow(database.admin, a.id)).encrypted_code).toEqual(codes[winner]);
  });

  it("gives only one process the exchange code", async () => {
    const a = await readyFlow(database.admin);
    const results = await Promise.all([claimFlow(first, a), claimFlow(second, a)]);
    expect(results.filter((value) => value !== null)).toEqual([ENVELOPE]);
    expect(await flowRow(database.admin, a.id)).toMatchObject({ status: "exchanging", encrypted_code: null });
  });

  it("makes cancellation and exchange mutually consistent", async () => {
    const a = await readyFlow(database.admin);
    const [code] = await Promise.all([claimFlow(first, a), endFlow(second, a, "cancel")]);
    const row = await flowRow(database.admin, a.id);
    expect(row.status).toBe(code === null ? "cancelled" : "exchanging");
    expect(row.encrypted_code).toBeNull();
  });

  it("does not steal an exchange with a new same-session start", async () => {
    const a = await readyFlow(database.admin);
    const b = { ...flowInput(), session: a.session };
    const [code, started] = await Promise.all([claimFlow(first, a), startFlow(second, b)]);
    expect([code !== null, started !== null].filter(Boolean)).toHaveLength(1);
    expect((await flowRow(database.admin, a.id)).status).toBe(code === null ? "cancelled" : "exchanging");
  });

  it("commits one connection under concurrent successful completions", async () => {
    const a = await readyFlow(database.admin);
    await claimFlow(database.admin, a);
    const results = await Promise.all([finishFlow(first, a), finishFlow(second, a)]);
    expect(results.sort()).toEqual([false, true]);
    const row = await flowRow(database.admin, a.id);
    expect(row.status).toBe("connected");
    expect((await database.admin.query("select 1 from app_bank.bank_connection_credentials where connection_id=$1", [row.connection_id])).rowCount).toBe(1);
  });

  it("checks the clock after acquiring a lock, not at transaction start", async () => {
    const a = await readyFlow(database.admin);
    const pid = (await first.query("select pg_backend_pid() as pid")).rows[0].pid;
    await second.query("begin");
    await second.query("select id from app_bank.bank_connection_requests where id=$1 for update", [a.id]);
    const pending = claimFlow(first, a);
    try {
      await expect.poll(async () => (await database.admin.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0]?.wait_event_type).toBe("Lock");
      // 실제로 대기한 transaction 이후에 만료 경계를 만든다. clock_timestamp 검사를 제거하면 이 시험은 실패한다.
      await second.query("select pg_sleep(0.02)");
      await second.query("update app_bank.bank_connection_requests set created_at=statement_timestamp()-interval '100 seconds',expires_at=statement_timestamp()+interval '200 seconds',callback_received_at=statement_timestamp()-interval '60 seconds',code_expires_at=statement_timestamp() where id=$1", [a.id]);
      await second.query("commit");
      expect(await pending).toBeNull();
      expect((await flowRow(database.admin, a.id)).status).toBe("expired");
    } finally {
      await second.query("rollback");
      await pending;
    }
  });
});

describe("bank function authority", () => {
  it("restricts all six entry functions to the API and a non-login non-owner role", async () => {
    const functions = await database.admin.query("select p.oid,p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_bank' and p.proname in ('start_request','callback_context','receive_callback','claim_exchange','finish_exchange','end_request')");
    expect(functions.rows).toHaveLength(6);
    for (const fn of functions.rows) {
      expect(fn).toMatchObject({ prosecdef: true, owner: "app_bank_flow", proconfig: ["search_path=pg_catalog, pg_temp"] });
      expect((await database.admin.query("select has_function_privilege('app_api',$1,'EXECUTE') as ok", [fn.oid])).rows[0].ok).toBe(true);
      for (const role of ["app_session_bff", "anon", "authenticated", "service_role"]) {
        expect((await database.admin.query("select has_function_privilege($1,$2,'EXECUTE') as ok", [role, fn.oid])).rows[0].ok).toBe(false);
      }
    }
    const role = await database.admin.query("select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname='app_bank_flow'");
    expect(Object.values(role.rows[0])).toEqual([false, false, false, false, false, false]);
    expect((await database.admin.query("select 1 from pg_auth_members where roleid='app_bank_flow'::regrole or member='app_bank_flow'::regrole")).rowCount).toBe(0);
    expect((await database.admin.query("select 1 from pg_class where relowner='app_bank_flow'::regrole and relkind='r'")).rowCount).toBe(0);
    expect((await database.admin.query("select has_schema_privilege('app_bank_flow','app_bank','CREATE') as ok")).rows[0].ok).toBe(false);
    await expect(asBankRole(database.admin, "app_api", undefined, () => database.admin.query("set role app_bank_flow"))).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects null session, missing identity and expired consent without partial completion", async () => {
    const a = await readyFlow(database.admin);
    expect((await flowCall(database.admin, a.user, () => database.admin.query("select app_bank.claim_exchange($1,null,$2) as code", [a.id, a.proof]))).rows[0].code).toBeNull();
    expect(await endFlow(database.admin, { ...a, user: "" }, "cancel")).toBeNull();
    await claimFlow(database.admin, a);
    const id = randomUUID();
    await expect(flowCall(database.admin, a.user, () => database.admin.query("select app_bank.finish_exchange($1,$2,$3,$4,$5,$5,null,clock_timestamp()+interval '1 hour',null,clock_timestamp()-interval '1 second')", [a.id, a.session, a.proof, id, ENVELOPE]))).rejects.toThrow("BANK_CONSENT_EXPIRED");
    expect((await database.admin.query("select 1 from app_bank.bank_connections where id=$1", [id])).rowCount).toBe(0);
  });
});
