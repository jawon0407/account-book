import { afterAll, beforeAll, expect, it } from "vitest";
import { asCoreRole, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";

let db: CoreDatabase, owner: string, other: string;
beforeAll(async () => { db = await openCoreDatabase(); owner = await seedUser(db.admin); other = await seedUser(db.admin); });
afterAll(async () => { await db?.close(); });

/** @param overrides 1개 경계만 바꾸는 합성 시각. @returns 실제 SQL로 저장한 행. 사용자 금융 정보는 쓰지 않는다. */
async function insertTime(overrides: Partial<{ user: string; instant: string | null; precision: string; source: string; zone: string | null; sourceZone: string | null; day: string }> = {}) {
  const v = { user: owner, instant: "2026-10-16T15:00:00.000Z", precision: "minute", source: "user", zone: "Asia/Seoul", sourceZone: "Asia/Seoul", day: "2026-10-17", ...overrides };
  return (await db.admin.query(`insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on,
    occurred_at,time_precision,time_source,source_time_zone,ledger_time_zone)
    values($1,'expense',20000,$2,$3,$4,$5,$6,$7) returning *`,
  [v.user,v.day,v.instant,v.precision,v.source,v.sourceZone,v.zone])).rows[0];
}

it("stores time evidence as API role, preserves day snapshot and separates receipt estimates", async () => {
  await asCoreRole(db.admin, "app_api", owner, async () => {
    const row = await insertTime();
    expect(row.occurred_at.toISOString()).toBe("2026-10-16T15:00:00.000Z");
    expect(row.time_precision).toBe("minute");
    expect(row.ledger_time_zone).toBe("Asia/Seoul");
    const updated = (await db.admin.query("update finance.transaction_history set memo='분류 확인' where id=$1 returning *", [row.id])).rows[0];
    expect(updated.occurred_on).toEqual(row.occurred_on);
    expect(updated.occurred_at).toEqual(row.occurred_at);
    expect(updated.version).toBe("2");
    expect((await insertTime({ source: "device_received", sourceZone: null })).time_source).toBe("device_received");
  });
});

it.each([
  ["UTC", "2026-10-16"], ["America/Los_Angeles", "2026-10-16"], ["Asia/Kathmandu", "2026-10-16"],
])("uses the explicit %s zone independent of server session timezone", async (zone, day) => {
  await asCoreRole(db.admin, "app_api", owner, async () => {
    await db.admin.query("set local timezone='Pacific/Auckland'");
    expect((await insertTime({ zone, day })).ledger_time_zone).toBe(zone);
  });
});

it.each([
  { instant: null }, { zone: null }, { zone: "KST" }, { zone: "+09:00" }, { zone: "Asia/Unknown" },
  { sourceZone: "Invalid/Zone" }, { zone: "A/" + "x".repeat(128) },
  { precision: "unknown" }, { source: "legacy_date" }, { source: "bank_verified" },
  { instant: "2026-10-16T15:00:01.000Z" },
  { precision: "second", instant: "2026-10-16T15:00:00.001Z" },
  { precision: "millisecond", instant: "2026-10-16T15:00:00.000001Z" },
  { instant: "infinity" }, { instant: "-infinity" }, { instant: "10000-01-01T00:00:00Z" },
  { day: "2026-10-16" },
  { precision: "day", instant: null, source: "notification", sourceZone: null },
  { precision: "day", instant: null, source: "user", sourceZone: "Asia/Seoul" },
])("rejects incoherent time input %j", async invalid => {
  await expect(asCoreRole(db.admin, "app_api", owner, () => insertTime(invalid))).rejects.toBeDefined();
});

it("accepts explicit date-only input and rejects a date-only edit retaining a contradictory instant", async () => {
  await asCoreRole(db.admin, "app_api", owner, async () => {
    expect((await insertTime({ instant: null, precision: "day", source: "user", sourceZone: null, zone: null })).occurred_at).toBeNull();
    expect((await insertTime({ precision: "millisecond", instant: "2026-10-16T15:00:00.123Z" })).occurred_at.toISOString()).toMatch(/\.123Z$/u);
  });
  const row = await insertTime();
  await expect(asCoreRole(db.admin, "app_api", owner, () => db.admin.query("update finance.transaction_history set occurred_on='2026-10-18' where id=$1", [row.id]))).rejects.toMatchObject({ code: "23514" });
  await asCoreRole(db.admin, "app_api", owner, async () => {
    const changed = (await db.admin.query("update finance.transaction_history set occurred_on='2026-10-18',occurred_at=null,time_precision='day',time_source='user',source_time_zone=null,ledger_time_zone=null where id=$1 returning occurred_at,version", [row.id])).rows[0];
    expect(changed).toEqual({ occurred_at: null, version: "2" });
  });
});

it("keeps owner isolation for time writes and denies missing user context", async () => {
  await expect(asCoreRole(db.admin, "app_api", other, () => insertTime())).rejects.toBeDefined();
  await expect(asCoreRole(db.admin, "app_api", undefined, () => insertTime())).rejects.toBeDefined();
});

it("does not grant BFF or public roles access to time fields", async () => {
  for (const role of ["app_session_bff", "anon", "authenticated", "service_role"] as const)
    await expect(asCoreRole(db.admin, role, owner, () => db.admin.query("select occurred_at from finance.transaction_history"))).rejects.toMatchObject({ code: "42501" });
});
