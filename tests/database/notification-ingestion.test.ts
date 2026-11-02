import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";
import {
  openNotificationConsentDatabase,
  withConsentClient,
} from "./support/notification-consent-fixtures.js";

describe("notification receipt storage isolation", () => {
  let db: CoreDatabase;
  beforeAll(async () => {
    db = await openNotificationConsentDatabase(true);
  });
  afterAll(async () => {
    await db?.close();
  });
  /** @param owner 합성 소유자. @returns 최소 미지정 지출 행. */
  async function transaction(owner: string) {
    return (
      await db.admin.query(
        "insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on) values($1,'expense',20000,'2026-11-02') returning id",
        [owner],
      )
    ).rows[0].id as string;
  }
  /** @param userId 인증 사용자. @param owner 저장할 소유자. @param id 원장 ID. @param event 동일 요청 식별자. */
  async function insert(
    userId: string,
    owner: string,
    id: string,
    event = randomUUID(),
  ) {
    return withConsentClient(userId, (c) =>
      c.query(
        `insert into finance.notification_receipts
      (user_id,event_id,transaction_id,request_fingerprint,source_app,parser_version,received_at,time_needs_review)
      values($1,$2,$3,$4,'com.kbstar.kbbank','kb-v1','2026-11-02T01:00:00.000Z',true) returning event_id`,
        [owner, event, id, Buffer.alloc(32, 1)],
      ),
    );
  }
  it("stores and returns only the authenticated owner's receipt", async () => {
    const owner = await seedUser(db.admin),
      stranger = await seedUser(db.admin),
      id = await transaction(owner);
    const created = await insert(owner, owner, id);
    expect(created.rowCount).toBe(1);
    expect(
      (
        await withConsentClient(stranger, (c) =>
          c.query("select * from finance.notification_receipts"),
        )
      ).rows,
    ).toEqual([]);
    await expect(insert(stranger, owner, id)).rejects.toMatchObject({
      code: "42501",
    });
    await expect(insert(stranger, stranger, id)).rejects.toMatchObject({
      code: "23503",
    });
  });
  it("enforces event uniqueness, v4 identifiers and immutable receipt access", async () => {
    const owner = await seedUser(db.admin),
      id = await transaction(owner),
      event = randomUUID();
    await insert(owner, owner, id, event);
    await expect(insert(owner, owner, id, event)).rejects.toMatchObject({
      code: "23505",
    });
    await expect(
      insert(owner, owner, id, "11111111-1111-1111-8111-111111111111"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      withConsentClient(owner, (c) =>
        c.query(
          "update finance.notification_receipts set parser_version='other' where event_id=$1",
          [event],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      withConsentClient(owner, (c) =>
        c.query("delete from finance.notification_receipts where event_id=$1", [
          event,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("forces RLS and exposes neither receipts nor raw notification columns publicly", async () => {
    expect(
      (
        await db.admin.query(
          "select relrowsecurity,relforcerowsecurity from pg_class where oid='finance.notification_receipts'::regclass",
        )
      ).rows[0],
    ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    for (const role of [
      "anon",
      "authenticated",
      "service_role",
      "app_session_bff",
    ]) {
      expect(
        (
          await db.admin.query(
            "select has_table_privilege($1,'finance.notification_receipts','SELECT,INSERT,UPDATE,DELETE') as allowed",
            [role],
          )
        ).rows[0].allowed,
      ).toBe(false);
      expect(
        (
          await db.admin.query(
            "select has_any_column_privilege($1,'finance.notification_receipts','SELECT,INSERT,UPDATE') as allowed",
            [role],
          )
        ).rows[0].allowed,
      ).toBe(false);
    }
    const columns = (
      await db.admin.query(
        "select column_name from information_schema.columns where table_schema='finance' and table_name='notification_receipts' order by ordinal_position",
      )
    ).rows.map((row) => row.column_name);
    expect(columns).toEqual([
      "user_id",
      "event_id",
      "transaction_id",
      "request_fingerprint",
      "source_app",
      "parser_version",
      "received_at",
      "time_needs_review",
      "created_at",
    ]);
  });
});
