import { createHash, timingSafeEqual } from "node:crypto";
import {
  IdempotencyKeySchema,
  NotificationIngestionInputSchema,
  NotificationReceiptSchema,
  type NotificationIngestionInput,
  type NotificationReceipt,
} from "@account-book/contracts";
import { CoreError, unavailable } from "../core/core-error.js";
import { input } from "../core/validation.js";
import { UserDatabase, type DbClient } from "../core/user-database.js";
import { resolveNotificationTime } from "./notification-time.js";

/** @param row DB 최소 접수 행. @returns 금액/알림 원문이 없는 공개 결과. */
function receipt(row: Record<string, unknown>): NotificationReceipt {
  return NotificationReceiptSchema.parse({
    eventId: row.event_id,
    transactionId: row.transaction_id,
    timeNeedsReview: row.time_needs_review,
  });
}

/** 원장과 접수 기록을 같은 transaction으로 저장한다. 다중 출처 유사 거래 판별과는 다른 요청 멱등성 경계다. */
export class NotificationTransactionsRepository {
  /** @param database 최소 권한 DB. @param enabled 기본 false; 합성 시험에서만 명시적으로 true를 주입한다. */
  public constructor(
    private readonly database: UserDatabase,
    private readonly enabled = false,
  ) {}

  /** @param userId 인증 회원. @param sessionId 인증 Android 세션. @param eventId 조회할 접수 UUID. 수집 중지 뒤에도 소유자 결과 확인은 가능하다. */
  public async get(
    userId: string,
    sessionId: string,
    eventId: string,
  ): Promise<NotificationReceipt> {
    if (!this.enabled) throw unavailable();
    const key = input(IdempotencyKeySchema, eventId).toLowerCase();
    return this.database.run(userId, async (client) => {
      try {
        await client.query("select * from app_private.collector_status($1)", [
          sessionId,
        ]);
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "28000"
        )
          throw new CoreError("AUTH_SESSION_EXPIRED", 401);
        throw error;
      }
      const result = await client.query(
        "select event_id,transaction_id,time_needs_review from finance.notification_receipts where user_id=$1 and event_id=$2",
        [userId, key],
      );
      if (!result.rows[0]) throw new CoreError("LEDGER_NOT_FOUND", 404);
      return receipt(result.rows[0]);
    });
  }

  /**
   * @param userId 인증 sub. @param sessionId 인증 sid. @param raw 정규화된 단일 알림(본문 신원은 받지 않음).
   * @returns 동일 접수의 원래 거래 ID. 수정/삭제 이후에도 기존 거래 내용을 덮어쓰지 않는다.
   */
  public async create(
    userId: string,
    sessionId: string,
    raw: NotificationIngestionInput,
  ): Promise<NotificationReceipt> {
    if (!this.enabled) throw unavailable();
    const value = input(NotificationIngestionInputSchema, raw),
      eventId = value.eventId.toLowerCase();
    // 동의/기기 버전은 현재 권한이다. 재동의한 정상 재조회에서 의미 fingerprint를 바꾸지 않는다.
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          sourceApp: value.sourceApp,
          parserVersion: value.parserVersion,
          type: value.type,
          amountKrw: value.amountKrw,
          counterpartyName: value.counterpartyName,
          receivedAt: value.receivedAt,
          transactionTime: value.transactionTime ?? null,
        }),
      )
      .digest();
    return this.database.runCollector(
      userId,
      sessionId,
      value.collectorVersion,
      value.consentVersion,
      async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1,0))",
          [`${userId}:notification:${eventId}`],
        );
        await this.checkAuthority(client, sessionId, value);
        const old = await client.query(
          "select * from finance.notification_receipts where user_id=$1 and event_id=$2",
          [userId, eventId],
        );
        if (old.rows[0]) {
          const digest: unknown = old.rows[0].request_fingerprint;
          if (!Buffer.isBuffer(digest) || digest.length !== 32)
            throw unavailable();
          if (!timingSafeEqual(digest, fingerprint))
            throw new CoreError("LEDGER_IDEMPOTENCY_CONFLICT", 409);
          return receipt(old.rows[0]);
        }
        const time = await resolveNotificationTime(client, userId, value);
        // 다른 잠금 대기 중 세션이 만료될 수 있으므로 실제 INSERT 직전에 다시 확인한다.
        await this.checkAuthority(client, sessionId, value);
        const created = await client.query(
          `insert into finance.transaction_history
        (user_id,kind,amount_krw,occurred_on,counterparty_name,occurred_at,time_precision,time_source,source_time_zone,ledger_time_zone)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [
            userId,
            value.type,
            value.amountKrw,
            time.occurredOn,
            value.counterpartyName,
            time.occurredAt,
            time.precision,
            time.source,
            time.sourceTimeZone,
            time.ledgerTimeZone,
          ],
        );
        const saved = await client.query(
          `insert into finance.notification_receipts
        (user_id,event_id,transaction_id,request_fingerprint,source_app,parser_version,received_at,time_needs_review)
        values($1,$2,$3,$4,$5,$6,$7,$8) returning event_id,transaction_id,time_needs_review`,
          [
            userId,
            eventId,
            created.rows[0].id,
            fingerprint,
            value.sourceApp,
            value.parserVersion,
            value.receivedAt,
            time.source === "device_received",
          ],
        );
        return receipt(saved.rows[0]);
      },
    );
  }

  /** @param client 같은 transaction. @param sid 인증 세션. @param value 현재 권한 세대. 잠금을 유지하며 시각 만료까지 재평가한다. */
  private async checkAuthority(
    client: DbClient,
    sid: string,
    value: NotificationIngestionInput,
  ) {
    const result = await client.query(
      "select app_private.lock_notification_collector($1,$2,$3) as allowed",
      [sid, value.collectorVersion, value.consentVersion],
    );
    if (result.rows[0]?.allowed !== true)
      throw new CoreError("AUTH_SESSION_EXPIRED", 401);
  }
}
