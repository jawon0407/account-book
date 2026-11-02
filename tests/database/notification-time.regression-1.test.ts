import { randomBytes, randomUUID } from "node:crypto";
import type { NotificationIngestionInput } from "@account-book/contracts";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { UserDatabase } from "../../apps/api/src/core/user-database.js";
import { NotificationTransactionsRepository } from "../../apps/api/src/notification-transactions/notification-transactions.repository.js";
import { TransactionsRepository } from "../../apps/api/src/transactions/transactions.repository.js";
import type { CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";
import { changeCollector, seedCollectorSession } from "./support/collector-fixtures.js";
import { CONSENT_URL, changeConsent, openNotificationConsentDatabase, withConsentClient } from "./support/notification-consent-fixtures.js";

// Regression: healthy contract — notification-specific SQL must select occurrence-time residence.
// Found by /qa on 2026-11-02
// Report: .gstack/qa-reports/run-20261102-notification-hardening/qa-report-notification-hardening-2026-11-02.md
let db: CoreDatabase, pool: Pool, repo: NotificationTransactionsRepository, ledger: TransactionsRepository;
beforeAll(async () => {
  db = await openNotificationConsentDatabase(true);
  const password = randomBytes(24).toString("hex");
  await db.admin.query(`create role notification_time_runner login password '${password}' in role app_api`);
  const url = new URL(CONSENT_URL); url.username = "notification_time_runner"; url.password = password;
  pool = new Pool({ connectionString: url.href, max: 2 });
  const database = new UserDatabase(pool);
  repo = new NotificationTransactionsRepository(database, true);
  ledger = new TransactionsRepository(database);
});
afterAll(async () => {
  await pool?.end();
  if (db) { await db.admin.query("drop role notification_time_runner"); await db.close(); }
});

/** @param changedAt 합성 거주 변경 UTC 시각. @returns 동의·대표 지정된 합성 회원과 Android 세션. */
async function setup(changedAt: string) {
  const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin, user);
  await withConsentClient(user, async client => { await changeConsent(client, sid, 0); await changeCollector(client, sid, 0); });
  // Existing time-api fixture pattern: only isolated setup bypasses the clock-setting trigger.
  // One transaction makes both the seeded history and trigger restoration atomic, even on failure.
  await db.admin.query("begin");
  try {
    await db.admin.query('alter table "user".ledger_time_history disable trigger ledger_time_history_insert');
    await db.admin.query(`insert into "user".ledger_time_history(user_id,revision,time_zone,effective_from,created_at)
      values($1,1,'Asia/Seoul',null,'2026-09-01T00:00:00Z'),
            ($1,2,'America/Los_Angeles',$2::timestamptz,$2::timestamptz)`, [user, changedAt]);
    await db.admin.query('alter table "user".ledger_time_history enable trigger ledger_time_history_insert');
    await db.admin.query("commit");
  } finally { await db.admin.query("rollback"); }
  return { user, sid };
}

/** @param occurredAt 알림의 거래 시각. @returns 변경 후 늦게 도착한 합성 분 단위 판독값. */
function input(occurredAt: string): NotificationIngestionInput {
  return { eventId: randomUUID(), collectorVersion: 1, consentVersion: 1, sourceApp: "com.kbstar.kbbank",
    parserVersion: "kb-v1", type: "expense", amountKrw: 20000, counterpartyName: "합성 상점",
    receivedAt: "2026-11-02T01:00:00.000Z",
    transactionTime: { occurredAt, precision: "minute", sourceTimeZone: "Asia/Seoul" } };
}

it.each([
  { name: "delayed old transaction", at: "2026-09-27T23:30:00.000Z", zone: "Asia/Seoul", date: "2026-09-28" },
  { name: "exact effective-from boundary", at: "2026-09-28T06:00:00.000Z", zone: "America/Los_Angeles", date: "2026-09-27" },
  { name: "change at exclusive precision end", at: "2026-09-28T05:59:00.000Z", zone: "Asia/Seoul", date: "2026-09-28" },
])("persists the correct residence snapshot for $name", async ({ at, zone, date }) => {
  const { user, sid } = await setup("2026-09-28T06:00:00.000Z"), value = input(at);
  const receipt = await repo.create(user, sid, value);
  expect(receipt.timeNeedsReview).toBe(false);
  expect(await repo.get(user, sid, value.eventId)).toEqual(receipt);
  const rows = (await ledger.list(user, {})).items;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: receipt.transactionId, occurredOn: date,
    time: { occurredAt: at, precision: "minute", source: "notification", sourceTimeZone: "Asia/Seoul", ledgerTimeZone: zone } });
  const saved = await db.admin.query("select transaction_id,received_at,time_needs_review from finance.notification_receipts where user_id=$1 and event_id=$2", [user, value.eventId]);
  expect(saved.rows).toEqual([{ transaction_id: receipt.transactionId, received_at: new Date(value.receivedAt), time_needs_review: false }]);
});

it("rejects a residence change inside a minute and leaves neither ledger nor receipt rows", async () => {
  const { user, sid } = await setup("2026-09-28T06:00:30.000Z"), value = input("2026-09-28T06:00:00.000Z");
  await expect(repo.create(user, sid, value)).rejects.toMatchObject({ status: 409, code: "LEDGER_TIME_REVIEW_REQUIRED" });
  expect((await ledger.list(user, {})).items).toEqual([]);
  // Check actual tables, not only a list API that could hide partial/deleted rows.
  const counts = await db.admin.query(`select
    (select count(*)::int from finance.transaction_history where user_id=$1) as transactions,
    (select count(*)::int from finance.notification_receipts where user_id=$1) as receipts`, [user]);
  expect(counts.rows).toEqual([{ transactions: 0, receipts: 0 }]);
  await expect(repo.get(user, sid, value.eventId)).rejects.toMatchObject({ status: 404, code: "LEDGER_NOT_FOUND" });
});
