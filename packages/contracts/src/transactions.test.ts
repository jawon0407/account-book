import { describe, expect, it } from "vitest";
import {
  CreateTransactionInputSchema,
  UpdateTransactionInputSchema,
  DeleteTransactionInputSchema,
  TransactionSchema,
  TransactionTombstoneSchema,
  CreateTransferInputSchema,
  CreateTransferResultSchema,
  TransactionListQuerySchema,
  TransactionListResponseSchema,
} from "./transactions.js";

const accountId = "123e4567-e89b-42d3-a456-426614174000";
const categoryId = "223e4567-e89b-42d3-a456-426614174000";
const idempotencyKey = "323e4567-e89b-42d3-a456-426614174000";
const transferId = "423e4567-e89b-42d3-a456-426614174000";
const timestamp = "2026-08-26T12:34:56.000Z";

const baseTransaction = {
  id: accountId,
  accountId,
  amountKrw: 15_000,
  occurredOn: "2026-08-26",
  memo: null,
  version: 1,
  deletedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("transaction command schemas", () => {
  it("normalizes valid create and update commands", () => {
    expect(CreateTransactionInputSchema.parse({
      accountId,
      amountKrw: 15_000,
      categoryId,
      idempotencyKey,
      memo: "  점심  ",
      occurredOn: "2026-08-26",
      type: "expense",
    })).toMatchObject({ amountKrw: 15_000, memo: "점심", type: "expense" });
    expect(UpdateTransactionInputSchema.parse({ expectedVersion: 3, memo: null })).toEqual({
      expectedVersion: 3,
      memo: null,
    });
    expect(DeleteTransactionInputSchema.parse({ expectedVersion: 3 })).toEqual({ expectedVersion: 3 });
  });

  it("rejects invalid transaction commands", () => {
    expect(() => UpdateTransactionInputSchema.parse({ expectedVersion: 3 })).toThrow();
    expect(() => CreateTransactionInputSchema.parse({ accountId, amountKrw: -15_000, categoryId, idempotencyKey, occurredOn: "2026-08-26", type: "expense" })).toThrow();
    expect(() => CreateTransactionInputSchema.parse({ accountId, amountKrw: 15_000, categoryId, idempotencyKey, occurredOn: "2026-08-26", type: "expense", userId: accountId })).toThrow();
    expect(() => CreateTransactionInputSchema.parse({ accountId, amountKrw: 15_000, categoryId, idempotencyKey, memo: "", occurredOn: "2026-08-26", type: "expense" })).toThrow();
    expect(() => CreateTransactionInputSchema.parse({ accountId, amountKrw: 15_000, categoryId, idempotencyKey, memo: "x".repeat(501), occurredOn: "2026-08-26", type: "expense" })).toThrow();
    expect(() => CreateTransactionInputSchema.parse({ accountId, amountKrw: 15_000, categoryId, idempotencyKey, occurredOn: "2026-08-26", type: "unknown" })).toThrow();
    expect(() => DeleteTransactionInputSchema.parse({})).toThrow();
    expect(() => CreateTransactionInputSchema.parse({ accountId, amountKrw: 1.5, categoryId, idempotencyKey, occurredOn: "2026-08-26", type: "expense" })).toThrow();
  });
});

describe("transfer and transaction response schemas", () => {
  it("validates transfer commands and atomic result kinds", () => {
    expect(CreateTransferInputSchema.parse({ amountKrw: 100, fromAccountId: accountId, idempotencyKey, occurredOn: "2026-08-26", toAccountId: categoryId })).toMatchObject({ amountKrw: 100 });
    expect(() => CreateTransferInputSchema.parse({ amountKrw: 100, fromAccountId: accountId, idempotencyKey, occurredOn: "2026-08-26", toAccountId: accountId })).toThrow();
    expect(() => CreateTransferInputSchema.parse({ amountKrw: 100, fromAccountId: accountId, idempotencyKey, occurredOn: "2026-08-26", toAccountId: categoryId, categoryId })).toThrow();
    expect(() => CreateTransferInputSchema.parse({ amountKrw: 100, fromAccountId: accountId, idempotencyKey, occurredOn: "2026-08-26", toAccountId: categoryId, ownerId: accountId })).toThrow();
  });

  it("accepts only matching transaction union combinations", () => {
    for (const value of [
      { ...baseTransaction, kind: "income", categoryId, transferId: null },
      { ...baseTransaction, kind: "expense", categoryId, transferId: null },
      { ...baseTransaction, kind: "transfer_out", categoryId: null, transferId },
      { ...baseTransaction, kind: "transfer_in", categoryId: null, transferId },
      { ...baseTransaction, kind: "opening_balance", categoryId: null, transferId: null },
    ]) expect(TransactionSchema.parse(value)).toMatchObject({ kind: value.kind });
    expect(() => TransactionSchema.parse({ ...baseTransaction, kind: "income", categoryId: null, transferId })).toThrow();
    expect(() => TransactionSchema.parse({ ...baseTransaction, kind: "transfer_in", categoryId, transferId: null })).toThrow();
    expect(() => TransactionSchema.parse({ ...baseTransaction, kind: "opening_balance", categoryId, transferId: null })).toThrow();
  });

  it("validates transfer result, tombstones, and strict bounded lists", () => {
    const debit = { ...baseTransaction, kind: "transfer_out", categoryId: null, transferId };
    const credit = { ...baseTransaction, kind: "transfer_in", categoryId: null, transferId };
    expect(CreateTransferResultSchema.parse({ debit, credit, transferId })).toMatchObject({ transferId });
    expect(() => CreateTransferResultSchema.parse({ debit: credit, credit: debit, transferId })).toThrow();
    expect(TransactionTombstoneSchema.parse({ id: accountId, version: 2, deletedAt: timestamp })).toEqual({ id: accountId, version: 2, deletedAt: timestamp });
    expect(() => TransactionListQuerySchema.parse({ from: "2026-08-27", to: "2026-08-26" })).toThrow();
    expect(() => TransactionListQuerySchema.parse({ nope: true })).toThrow();
    expect(() => TransactionListResponseSchema.parse({ items: Array.from({ length: 101 }, () => ({ ...baseTransaction, kind: "opening_balance", categoryId: null, transferId: null })), nextCursor: null })).toThrow();
  });
});
