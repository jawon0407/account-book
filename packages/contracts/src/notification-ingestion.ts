import { z } from "zod";
import { IdempotencyKeySchema, LedgerIdSchema } from "./ledger-common.js";
import { UtcInstantSchema } from "./ledger-time.js";
import { ManualLedgerTimeInputSchema } from "./transaction-time.js";

const Generation = z.number().int().min(1).max(2_147_483_647);
/** 원문 대신 판독된 최소 값만 받는다. 기기/사용자 신원은 서명된 세션에서 결정한다. */
export const NotificationIngestionInputSchema = z
  .object({
    eventId: IdempotencyKeySchema,
    collectorVersion: Generation,
    consentVersion: Generation,
    sourceApp: z.literal("com.kbstar.kbbank"),
    parserVersion: z.literal("kb-v1"),
    type: z.enum(["income", "expense"]),
    amountKrw: z.number().int().min(1).max(999_999_999_999),
    counterpartyName: z
      .string()
      .min(1)
      .max(80)
      .refine(
        (value) => value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value),
      )
      .nullable(),
    receivedAt: UtcInstantSchema,
    // 구조는 수기 시각과 같지만 출처는 서버에서 notification으로 고정한다.
    transactionTime: ManualLedgerTimeInputSchema.optional(),
  })
  .strict();
export type NotificationIngestionInput = z.infer<
  typeof NotificationIngestionInputSchema
>;

/** 같은 접수 결과를 찾기 위한 최소 응답. 금융 값은 기존 거래 조회 경로로만 읽는다. */
export const NotificationReceiptSchema = z
  .object({
    eventId: IdempotencyKeySchema,
    transactionId: LedgerIdSchema,
    timeNeedsReview: z.boolean(),
  })
  .strict();
export type NotificationReceipt = z.infer<typeof NotificationReceiptSchema>;
