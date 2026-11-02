import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NativeRateLimiter } from "../../apps/web/src/server/native-auth/native-rate-limiter.js";
import { CORE_URL, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
let database: CoreDatabase;
const key = randomBytes(32);
beforeAll(async () => {
  database = await openCoreDatabase();
  await database.admin.query(await readFile(new URL("../../supabase/migrations/20261016044255_native_auth_rate_limits.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await database?.close(); });

/** 실제 BFF 권한을 적용한 별도 연결. 경쟁 시험도 연결 상태를 공유하지 않는다. */
async function bff() { const client = new Client({ connectionString: CORE_URL }); await client.connect(); await client.query("set session authorization app_session_bff"); return client; }

describe("native DB rate limits", () => {
  it("caps concurrent requests atomically across independent BFF connections", async () => {
    const one = await bff(), two = await bff();
    try {
      const a = new NativeRateLimiter((sql, values) => one.query(sql, values), key);
      const b = new NativeRateLimiter((sql, values) => two.query(sql, values), key);
      const identity = randomUUID();
      const allowed = await Promise.all([a, b].map(async limiter => {
        const results = [];
        for (let i = 0; i < 10; i++) results.push(await limiter.consume("signIn", "email", identity));
        return results;
      }));
      expect(allowed.flat().filter(Boolean)).toHaveLength(6);
      const stored = await database.admin.query("select count,window_seconds from app_private.auth_rate_limits where kind='native_auth'");
      expect(stored.rows).toEqual([{ count: 7, window_seconds: 600 }]);
    } finally { await one.end(); await two.end(); }
  });
  it("removes only stale native buckets, bounded to 500 per global request", async () => {
    await database.admin.query("insert into app_private.auth_rate_limits(fingerprint,kind,window_started_at,window_seconds,count) select decode(md5(i::text)||md5(i::text),'hex'),'native_auth',now()-interval '30 minutes',60,1 from generate_series(1,501) i");
    await database.admin.query("insert into app_private.auth_rate_limits(fingerprint,kind,window_started_at,window_seconds,count) values($1,'sign_in',now()-interval '30 minutes',60,1)", [randomBytes(32)]);
    const client = await bff();
    try { await new NativeRateLimiter((sql, values) => client.query(sql, values), key).consume("session", "global", "all"); }
    finally { await client.end(); }
    const remaining = await database.admin.query("select kind,count(*)::integer n from app_private.auth_rate_limits where window_started_at < now()-interval '20 minutes' group by kind order by kind");
    expect(remaining.rows).toEqual([{ kind: "native_auth", n: 1 }, { kind: "sign_in", n: 1 }]);
  });
  it.each(["app_api", "anon", "authenticated", "service_role"])("denies private buckets to %s", async role => {
    const client = new Client({ connectionString: CORE_URL }); await client.connect();
    try { await client.query(`set session authorization ${role}`); await expect(client.query("select * from app_private.auth_rate_limits")).rejects.toMatchObject({ code: "42501" }); }
    finally { await client.end(); }
  });
  it("retains old kinds and rejects unknown kinds", async () => {
    for (const kind of ["sign_in", "sign_up", "password_reset", "oauth_start"]) {
      await database.admin.query("insert into app_private.auth_rate_limits(fingerprint,kind,window_started_at,window_seconds,count) values($1,$2,now(),60,1)", [randomBytes(32), kind]);
    }
    await expect(database.admin.query("insert into app_private.auth_rate_limits(fingerprint,kind,window_started_at,window_seconds,count) values($1,'unknown',now(),60,1)", [randomBytes(32)])).rejects.toMatchObject({ code: "23514" });
  });
  it("keeps ledger read/write and auth identity budgets independent in the same table", async () => {
    const client = await bff();
    try {
      const limiter = new NativeRateLimiter((sql, values) => client.query(sql, values), key), identity = randomUUID();
      for (let n = 0; n < 31; n++) expect(await limiter.consume("ledgerWrite", "identity", identity)).toBe(n < 30);
      expect(await limiter.consume("ledgerRead", "identity", identity)).toBe(true);
      expect(await limiter.consume("session", "identity", identity)).toBe(true);
    } finally { await client.end(); }
  });
});
