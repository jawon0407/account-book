import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { timeApiFixture } from "./support/time-api-fixture.js";
import { seedUser } from "./support/core-fixtures.js";

let db: Awaited<ReturnType<typeof timeApiFixture>>;
beforeAll(async () => { db = await timeApiFixture(); });
afterAll(async () => { await db?.close(); });

it("sets the first residence explicitly and changes nickname/timezone in one version", async () => {
  const user = await seedUser(db.admin);
  expect(await db.profiles.get(user)).toMatchObject({ ledgerTimeZone: null, version: 1 });
  expect(await db.profiles.update(user, { expectedVersion: 1, nickname: "합성 이름", ledgerTimeZone: "Asia/Seoul" }))
    .toMatchObject({ nickname: "합성 이름", ledgerTimeZone: "Asia/Seoul", version: 2 });
  expect(await db.profiles.update(user, { expectedVersion: 2, ledgerTimeZone: "UTC" }))
    .toMatchObject({ nickname: "합성 이름", ledgerTimeZone: "UTC", version: 3 });
  const rows = (await db.admin.query('select * from "user".ledger_time_history where user_id=$1 order by revision', [user])).rows;
  expect(rows).toHaveLength(2); expect(rows[0].effective_from).toBeNull();
  expect(rows[1].effective_from).toEqual(rows[1].created_at);
});
it("keeps unchanged settings without duplicate history and rejects competing versions atomically", async () => {
  const user = await seedUser(db.admin);
  await db.profiles.update(user, { expectedVersion: 1, ledgerTimeZone: "Asia/Seoul" });
  await db.profiles.update(user, { expectedVersion: 2, ledgerTimeZone: "asia/seoul" });
  expect((await db.admin.query('select * from "user".ledger_time_history where user_id=$1', [user])).rowCount).toBe(1);
  const results = await Promise.allSettled(["UTC", "America/Los_Angeles"].map(ledgerTimeZone => db.profiles.update(user, { expectedVersion: 3, ledgerTimeZone })));
  expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(results.find(x => x.status === "rejected")).toMatchObject({ reason: { code: "PROFILE_VERSION_CONFLICT" } });
  expect((await db.admin.query('select * from "user".ledger_time_history where user_id=$1', [user])).rowCount).toBe(2);
});
it("validates at repository entry and isolates owners/missing/deleted profiles", async () => {
  const user = await seedUser(db.admin), other = await seedUser(db.admin);
  await db.profiles.update(user, { expectedVersion: 1, ledgerTimeZone: "UTC" });
  expect((await db.profiles.get(other)).ledgerTimeZone).toBeNull();
  await expect(db.profiles.update(user, { expectedVersion: 2, ledgerTimeZone: "invalid" })).rejects.toMatchObject({ code: "PROFILE_VALIDATION_FAILED" });
  expect((await db.profiles.get(user)).version).toBe(2);
  await db.admin.query('update "user".users set deleted_at=now() where user_id=$1', [user]);
  for (const id of [user, randomUUID()]) await expect(db.profiles.update(id, { expectedVersion: 2, ledgerTimeZone: "UTC" })).rejects.toMatchObject({ status: 401 });
});
it.each(["America/Nowhere", "Asia/../UTC", "GMT0", "PST8PDT", "AAA1/BBB", "Asia/Seoul+09", "+09:00", "UTC "])("rejects non-IANA or unknown DB zone %s", async zone => {
  expect((await db.admin.query('select "user".is_ledger_time_zone($1) as valid', [zone])).rows[0].valid).toBe(false);
});
