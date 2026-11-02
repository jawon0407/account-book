import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { CreateTransactionInputSchema } from "@account-book/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { timeApiFixture } from "./support/time-api-fixture.js";
import { seedUser } from "./support/core-fixtures.js";

let db: Awaited<ReturnType<typeof timeApiFixture>>;
beforeAll(async () => { db = await timeApiFixture(); });
afterAll(async () => { await db?.close(); });
const time = { occurredAt: "2026-09-28T06:53:00.000Z", precision: "minute" as const, sourceTimeZone: "Asia/Seoul" };
const entry = () => ({ type: "expense" as const, amountKrw: 20000, occurredOn: "2026-09-28", time, idempotencyKey: randomUUID() });
/** @param user 합성 회원. @param count 만들 거주 이력 수. 과거 변경·경계·대량 이력 검증용이며 runtime 권한이 아니다. */
async function history(user: string, count = 2) {
  // 수백 번의 거주 변경을 합성하는 setup만 여유를 둔다. runtime query timeout은 바꾸지 않는다.
  await db.admin.query("set statement_timeout='30s'");
  await db.admin.query('alter table "user".ledger_time_history disable trigger ledger_time_history_insert');
  try {
    await db.admin.query(`insert into "user".ledger_time_history(user_id,revision,time_zone,effective_from,created_at)
      select $1,n,case when n%2=1 then 'Asia/Seoul' else 'America/Los_Angeles' end,
        case when n=1 then null else '2026-09-28T06:00:00Z'::timestamptz + n*interval '1 second' end,
        '2026-09-28T06:00:00Z'::timestamptz + n*interval '1 second' from generate_series(1,$2::integer) n`, [user, count]);
  } finally {
    await db.admin.query('alter table "user".ledger_time_history enable trigger ledger_time_history_insert');
    await db.admin.query("set statement_timeout='3s'");
  }
}
it("requires a residence setting only for timed creation and preserves unknown time otherwise", async () => {
  const user = await seedUser(db.admin);
  await expect(db.transactions.create(user, entry())).rejects.toMatchObject({ code: "LEDGER_TIME_SETUP_REQUIRED" });
  const plain = await db.transactions.create(user, { type: "income", amountKrw: 20, occurredOn: "2026-09-28", idempotencyKey: randomUUID() });
  expect(plain.time).toMatchObject({ occurredAt: null, precision: "day", source: "user", ledgerTimeZone: null });
  expect((await db.transactions.list(user, {})).items).toHaveLength(1);
});
it("stores the owner's occurrence-time zone, replays first snapshot across moves and rejects changed intent", async () => {
  const user = await seedUser(db.admin), other = await seedUser(db.admin), value = entry();
  await db.profiles.update(user, { expectedVersion: 1, ledgerTimeZone: "Asia/Seoul" });
  const [a,b] = await Promise.all([db.transactions.create(user, value), db.transactions.create(user, value)]);
  expect(b).toEqual(a); expect(a.time).toMatchObject({ ...time, source: "user", ledgerTimeZone: "Asia/Seoul" });
  await db.profiles.update(user, { expectedVersion: 2, ledgerTimeZone: "America/Los_Angeles" });
  expect(await db.transactions.create(user, value)).toEqual(a);
  await expect(db.transactions.create(user, { ...value, time: { ...time, occurredAt: "2026-09-28T06:54:00.000Z" } })).rejects.toMatchObject({ code: "LEDGER_IDEMPOTENCY_CONFLICT" });
  expect((await db.transactions.list(other, {})).items).toEqual([]);
  await expect(db.transactions.create(other, entry())).rejects.toMatchObject({ code: "LEDGER_TIME_SETUP_REQUIRED" });
});
it("accepts the mobile historical residence correction without changing the known instant", async () => {
  const user = await seedUser(db.admin);
  await db.profiles.update(user, { expectedVersion: 1, ledgerTimeZone: "Asia/Seoul" });
  await db.profiles.update(user, { expectedVersion: 2, ledgerTimeZone: "America/Los_Angeles" });
  // 모바일 정규화 시험이 같은 fixture와 전체 payload 일치를 확인한다. 네이티브 화면 실행 증거는 아니다.
  const wire = CreateTransactionInputSchema.parse({ ...JSON.parse(readFileSync(new URL("../fixtures/mobile-historical-transaction.json", import.meta.url), "utf8")), idempotencyKey: randomUUID() });
  await expect(db.transactions.create(user, { ...wire, occurredOn: "2026-09-30" })).rejects.toMatchObject({ code: "LEDGER_TIME_REVIEW_REQUIRED" });
  const row = await db.transactions.create(user, wire);
  expect(row.occurredOn).toBe("2026-10-01");
  expect(row.time).toMatchObject({ occurredAt: "2026-10-01T00:00:00.000Z", ledgerTimeZone: "Asia/Seoul" });
});
it("uses relevant history beyond 256 changes and refuses calendar mismatches", async () => {
  const user = await seedUser(db.admin); await history(user, 300);
  const value = entry();
  await expect(db.transactions.create(user, value)).rejects.toMatchObject({ code: "LEDGER_TIME_REVIEW_REQUIRED" });
  const row = await db.transactions.create(user, { ...value, occurredOn: "2026-09-27" });
  expect(row.time?.ledgerTimeZone).toBe("America/Los_Angeles");
  const earlier = await db.transactions.create(user, { ...entry(), time: { ...time, occurredAt: "2026-09-28T05:00:00.000Z" } });
  expect(earlier.time?.ledgerTimeZone).toBe("Asia/Seoul");
}, 40_000);
it("requires confirmation when precision crosses a change, but allows the exact new boundary", async () => {
  const user = await seedUser(db.admin); await history(user);
  await expect(db.transactions.create(user, { ...entry(), time: { ...time, occurredAt: "2026-09-28T06:00:00.000Z" } })).rejects.toMatchObject({ code: "LEDGER_TIME_REVIEW_REQUIRED" });
  const row = await db.transactions.create(user, { ...entry(), occurredOn: "2026-09-27", time: { ...time, occurredAt: "2026-09-28T06:00:02.000Z", precision: "second" } });
  expect(row.time?.ledgerTimeZone).toBe("America/Los_Angeles");
});
it("preserves time on unrelated edits and requires explicit clearing before date-only correction", async () => {
  const user = await seedUser(db.admin); await db.profiles.update(user, { expectedVersion: 1, ledgerTimeZone: "Asia/Seoul" });
  const original = await db.transactions.create(user, entry());
  const edited = await db.transactions.update(user, original.id, { expectedVersion: 1, memo: "새 메모", occurredOn: original.occurredOn });
  expect(edited.time).toEqual(original.time);
  await expect(db.transactions.update(user, original.id, { expectedVersion: 2, occurredOn: "2026-09-29" })).rejects.toMatchObject({ code: "LEDGER_TIME_CHANGE_REQUIRED" });
  const cleared = await db.transactions.update(user, original.id, { expectedVersion: 2, occurredOn: "2026-09-29", time: null });
  expect(cleared.time).toMatchObject({ occurredOn: "2026-09-29", occurredAt: null, precision: "day", source: "user" });
  await expect(db.transactions.update(user, original.id, { expectedVersion: 2, memo: "stale" })).rejects.toMatchObject({ code: "LEDGER_VERSION_CONFLICT" });
});
it("pages timed and date-only rows without repeats or omissions, binding the cursor to its owner", async () => {
  const user = await seedUser(db.admin), other = await seedUser(db.admin);
  await db.profiles.update(user, { expectedVersion: 1, ledgerTimeZone: "UTC" });
  const values = ["2026-09-28T18:00:00.000Z", "2026-09-28T10:00:00.000Z", "2026-09-28T10:00:00.000Z", null, null];
  const rows = [];
  for (const at of values) rows.push(await db.transactions.create(user, { type: "expense", amountKrw: 10, occurredOn: "2026-09-28", idempotencyKey: randomUUID(), ...(at ? { time: { ...time, occurredAt: at } } : {}) }));
  const sorted = rows.toSorted((a,b) => (b.time?.occurredAt ?? "").localeCompare(a.time?.occurredAt ?? "") || b.id.localeCompare(a.id));
  const actual: string[] = []; let cursor: string | undefined;
  do {
    const page = await db.transactions.list(user, { limit: 1, ...(cursor ? { cursor } : {}) });
    actual.push(...page.items.map(x => x.id)); cursor = page.nextCursor ?? undefined;
    if (cursor) await expect(db.transactions.list(other, { cursor })).rejects.toMatchObject({ code: "LEDGER_VALIDATION_FAILED" });
  } while (cursor && actual.length < 7);
  expect(actual).toEqual(sorted.map(x => x.id));
});
