import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserDatabase } from "../../apps/api/src/core/user-database.js";
import { NotificationTransactionsRepository } from "../../apps/api/src/notification-transactions/notification-transactions.repository.js";
import { TransactionsRepository } from "../../apps/api/src/transactions/transactions.repository.js";
import type { NotificationIngestionInput } from "@account-book/contracts";
import type { CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";
import {
  changeCollector,
  seedCollectorSession,
} from "./support/collector-fixtures.js";
import {
  CONSENT_URL,
  changeConsent,
  consentClient,
  openNotificationConsentDatabase,
  withConsentClient,
} from "./support/notification-consent-fixtures.js";

describe("atomic notification ingestion with real RLS", () => {
  let db: CoreDatabase,
    pool: Pool,
    repo: NotificationTransactionsRepository,
    ledger: TransactionsRepository;
  beforeAll(async () => {
    db = await openNotificationConsentDatabase(true);
    const password = randomBytes(24).toString("hex");
    await db.admin.query(
      `create role notification_ingestion_runner login password '${password}' in role app_api`,
    );
    const url = new URL(CONSENT_URL);
    url.username = "notification_ingestion_runner";
    url.password = password;
    pool = new Pool({ connectionString: url.href, max: 4 });
    const database = new UserDatabase(pool);
    repo = new NotificationTransactionsRepository(database, true);
    ledger = new TransactionsRepository(database);
  });
  afterAll(async () => {
    await pool?.end();
    if (db) {
      await db.admin.query("drop role notification_ingestion_runner");
      await db.close();
    }
  });
  /** @returns 독립 합성 회원·Android 세션과 선택한 장부 기준. */
  async function setup(zone = "Asia/Seoul") {
    const user = await seedUser(db.admin),
      sid = await seedCollectorSession(db.admin, user);
    await withConsentClient(user, async (c) => {
      await changeConsent(c, sid, 0);
      await changeCollector(c, sid, 0);
      await c.query(
        'insert into "user".ledger_time_history(user_id,time_zone) values($1,$2)',
        [user, zone],
      );
    });
    return { user, sid };
  }
  /** @returns 실제 계좌/이름이 아닌 합성 정규화 입력. */
  function input(): NotificationIngestionInput {
    return {
      eventId: randomUUID(),
      collectorVersion: 1,
      consentVersion: 1,
      sourceApp: "com.kbstar.kbbank",
      parserVersion: "kb-v1",
      type: "expense",
      amountKrw: 20_000,
      counterpartyName: "합성 상점",
      receivedAt: "2026-11-02T01:00:00.000Z",
    };
  }
  it("saves one unassigned ledger row and minimal receipt even under concurrent retries", async () => {
    const a = await setup(),
      value = input();
    const receipts = await Promise.all([
      repo.create(a.user, a.sid, value),
      repo.create(a.user, a.sid, value),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(receipts[0]!.timeNeedsReview).toBe(true);
    expect(await repo.get(a.user, a.sid, value.eventId)).toEqual(receipts[0]);
    const rows = (await ledger.list(a.user, {})).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "expense",
      amountKrw: 20_000,
      accountId: null,
      categoryId: null,
      counterpartyName: "합성 상점",
      time: {
        source: "device_received",
        occurredAt: value.receivedAt,
        ledgerTimeZone: "Asia/Seoul",
      },
    });
  });
  it("rejects same event with changed financial values but accepts a new event", async () => {
    const a = await setup(),
      value = input();
    await repo.create(a.user, a.sid, value);
    await expect(
      repo.create(a.user, a.sid, { ...value, amountKrw: 20_001 }),
    ).rejects.toMatchObject({
      status: 409,
      code: "LEDGER_IDEMPOTENCY_CONFLICT",
    });
    await repo.create(a.user, a.sid, { ...value, eventId: randomUUID() });
    expect((await ledger.list(a.user, {})).items).toHaveLength(2);
  });
  it("does not overwrite an edited or soft-deleted transaction on replay", async () => {
    const a = await setup(),
      value = input(),
      receipt = await repo.create(a.user, a.sid, value);
    await ledger.update(a.user, receipt.transactionId, {
      expectedVersion: 1,
      memo: "사용자 수정",
    });
    expect(await repo.create(a.user, a.sid, value)).toEqual(receipt);
    expect((await ledger.list(a.user, {})).items[0]).toMatchObject({
      memo: "사용자 수정",
      version: 2,
    });
    await ledger.remove(a.user, receipt.transactionId, { expectedVersion: 2 });
    expect(await repo.create(a.user, a.sid, value)).toEqual(receipt);
    expect((await ledger.list(a.user, {})).items).toEqual([]);
  });
  it("denies revoked consent and old collector generations, but keeps result lookup after stopping", async () => {
    const a = await setup(),
      value = input(),
      receipt = await repo.create(a.user, a.sid, value);
    await withConsentClient(a.user, (c) =>
      changeConsent(c, a.sid, 1, "withdraw"),
    );
    await expect(repo.create(a.user, a.sid, input())).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    expect(await repo.get(a.user, a.sid, value.eventId)).toEqual(receipt);
    await withConsentClient(a.user, (c) => changeConsent(c, a.sid, 2));
    expect(
      await repo.create(a.user, a.sid, { ...value, consentVersion: 3 }),
    ).toEqual(receipt);
    const other = await seedCollectorSession(db.admin, a.user);
    await withConsentClient(a.user, async (c) => {
      await changeConsent(c, other, 0);
      await changeCollector(c, other, 1, "activate", true);
    });
    await expect(
      repo.create(a.user, a.sid, { ...input(), consentVersion: 3 }),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    await repo.create(a.user, other, { ...input(), collectorVersion: 2 });
  });
  it("does not save when a concurrent withdrawal commits before the authority lock", async () => {
    const a = await setup();
    const withdrawing = await consentClient(a.user);
    try {
      await changeConsent(withdrawing, a.sid, 1, "withdraw");
      // 철회 transaction이 동의 행을 잡은 동안 실제 접수 요청이 기다리는지 확인한다.
      const pending = repo.create(a.user, a.sid, input()).then(
        value => ({ value, error: undefined }),
        error => ({ value: undefined, error }),
      );
      await expect.poll(async () => {
        const result = await db.admin.query(`select count(*)::int n from pg_stat_activity
          where usename='notification_ingestion_runner' and wait_event_type='Lock'`);
        return result.rows[0].n;
      }, { timeout: 700, interval: 10 }).toBe(1);
      await withdrawing.query("commit");
      expect((await pending).error).toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
      expect((await ledger.list(a.user, {})).items).toEqual([]);
    } finally {
      await withdrawing.query("rollback");
      await withdrawing.end();
    }
  });
  it("isolates users and rejects invalid, revoked and web sessions", async () => {
    const a = await setup(),
      b = await setup(),
      value = input();
    await repo.create(a.user, a.sid, value);
    await expect(repo.get(b.user, b.sid, value.eventId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(repo.create(b.user, a.sid, input())).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    const web = await seedCollectorSession(db.admin, a.user, "web");
    await expect(repo.create(a.user, web, input())).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    await db.admin.query(
      "update app_private.auth_sessions set revoked_at=now() where id=$1",
      [a.sid],
    );
    await expect(repo.create(a.user, a.sid, input())).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
    await expect(repo.get(a.user, a.sid, value.eventId)).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
  });
  it("uses notification time over arrival and the owner's residence date", async () => {
    const a = await setup("America/New_York"),
      value = {
        ...input(),
        transactionTime: {
          occurredAt: "2026-11-02T00:30:00.000Z",
          precision: "minute" as const,
          sourceTimeZone: "Asia/Seoul",
        },
      };
    expect((await repo.create(a.user, a.sid, value)).timeNeedsReview).toBe(
      false,
    );
    expect((await ledger.list(a.user, {})).items[0]).toMatchObject({
      occurredOn: "2026-11-01",
      time: {
        source: "notification",
        occurredAt: value.transactionTime.occurredAt,
      },
    });
  });
  it("requires time review after a residence change and leaves no partial writes", async () => {
    const a = await setup();
    await withConsentClient(a.user, (c) =>
      c.query(
        "insert into \"user\".ledger_time_history(user_id,time_zone) values($1,'UTC')",
        [a.user],
      ),
    );
    await expect(repo.create(a.user, a.sid, input())).rejects.toMatchObject({
      code: "LEDGER_TIME_REVIEW_REQUIRED",
    });
    expect((await ledger.list(a.user, {})).items).toEqual([]);
    expect(
      (
        await db.admin.query(
          "select count(*)::int n from finance.notification_receipts where user_id=$1",
          [a.user],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("rolls back a ledger insertion if receipt persistence fails", async () => {
    const a = await setup();
    await db.admin.query(
      "create function finance.test_reject_receipt() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$; create trigger test_reject before insert on finance.notification_receipts for each row execute function finance.test_reject_receipt()",
    );
    try {
      await expect(repo.create(a.user, a.sid, input())).rejects.toMatchObject({
        code: "LEDGER_SERVICE_UNAVAILABLE",
      });
    } finally {
      await db.admin.query(
        "drop trigger test_reject on finance.notification_receipts; drop function finance.test_reject_receipt()",
      );
    }
    expect((await ledger.list(a.user, {})).items).toEqual([]);
  });
  it("is disabled by default and does not persist with the existing preview-only notice", async () => {
    const a = await setup(),
      disabled = new NotificationTransactionsRepository(new UserDatabase(pool));
    await expect(disabled.create(a.user, a.sid, input())).rejects.toMatchObject(
      { status: 503 },
    );
    await expect(
      disabled.get(a.user, a.sid, randomUUID()),
    ).rejects.toMatchObject({ status: 503 });
    expect((await ledger.list(a.user, {})).items).toEqual([]);
  });
});
