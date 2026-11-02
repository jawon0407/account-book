import { describe, expect, it } from "vitest";
import {
  NotificationIngestionInputSchema,
  NotificationReceiptSchema,
} from "./notification-ingestion.js";

const eventId = "11111111-1111-4111-8111-111111111111";
const value = {
  eventId,
  collectorVersion: 1,
  consentVersion: 1,
  sourceApp: "com.kbstar.kbbank",
  parserVersion: "kb-v1",
  type: "expense",
  amountKrw: 20_000,
  counterpartyName: "합성 상점",
  receivedAt: "2026-11-02T01:00:00.000Z",
};

describe("minimal notification ingestion contract", () => {
  it("accepts unassigned income/expense without an account or category", () => {
    expect(NotificationIngestionInputSchema.parse(value)).toEqual(value);
    expect(
      NotificationIngestionInputSchema.parse({
        ...value,
        type: "income",
        counterpartyName: null,
      }),
    ).toMatchObject({ counterpartyName: null });
  });
  it("accepts only resolved UTC transaction time with honest precision", () => {
    const transactionTime = {
      occurredAt: "2026-11-02T00:59:00.000Z",
      precision: "minute",
      sourceTimeZone: "Asia/Seoul",
    };
    expect(
      NotificationIngestionInputSchema.parse({ ...value, transactionTime })
        .transactionTime,
    ).toEqual(transactionTime);
    expect(
      NotificationIngestionInputSchema.safeParse({
        ...value,
        transactionTime: {
          ...transactionTime,
          occurredAt: "2026-11-02T00:59:01.000Z",
        },
      }).success,
    ).toBe(false);
    expect(
      NotificationIngestionInputSchema.safeParse({
        ...value,
        transactionTime: { ...transactionTime, source: "user" },
      }).success,
    ).toBe(false);
  });
  it.each([
    "rawText",
    "title",
    "accountNumber",
    "userId",
    "sessionId",
    "deviceId",
    "accountId",
    "categoryId",
    "memo",
  ])(
    "rejects unexpected %s rather than silently retaining or stripping it",
    (field) => {
      expect(
        NotificationIngestionInputSchema.safeParse({
          ...value,
          [field]: "private-value",
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    { eventId: "not-a-uuid" },
    { eventId: "11111111-1111-1111-8111-111111111111" },
    { collectorVersion: 0 },
    { consentVersion: 0 },
    { collectorVersion: 2147483648 },
    { amountKrw: 0 },
    { amountKrw: -1 },
    { amountKrw: 1.1 },
    { amountKrw: 1_000_000_000_000 },
    { type: "card_approval" },
    { parserVersion: "unknown" },
    { sourceApp: "unknown.app" },
    { counterpartyName: " " },
    { counterpartyName: "x".repeat(81) },
    { counterpartyName: "private\ntext" },
    { receivedAt: "2026-11-02 10:00" },
    { receivedAt: "2026-02-30T00:00:00.000Z" },
  ])("rejects malformed or unsupported input %j", (change) => {
    expect(
      NotificationIngestionInputSchema.safeParse({ ...value, ...change })
        .success,
    ).toBe(false);
  });
  it("returns a small receipt without a second financial payload copy", () => {
    const receipt = { eventId, transactionId: eventId, timeNeedsReview: true };
    expect(NotificationReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(
      NotificationReceiptSchema.safeParse({ ...receipt, amountKrw: 20_000 })
        .success,
    ).toBe(false);
  });
});
