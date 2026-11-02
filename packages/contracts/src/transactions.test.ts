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
  type CreateTransactionInput,
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
  it.each(["income", "expense"])("accepts unassigned %s without inventing references", (type) => {
    const input = { amountKrw: 100, idempotencyKey, occurredOn: "2026-10-16", type };
    expect(CreateTransactionInputSchema.parse(input)).toMatchObject({ accountId: null, categoryId: null });
    for (const account of [accountId, null]) for (const category of [categoryId, null]) {
      expect(CreateTransactionInputSchema.parse({ ...input, accountId: account, categoryId: category })).toMatchObject({ accountId: account, categoryId: category });
      expect(TransactionSchema.parse({ ...baseTransaction, kind: type, accountId: account, categoryId: category, transferId: null })).toMatchObject({ accountId: account, categoryId: category, counterpartyName: null });
    }
  });

  it("allows typed callers to omit unresolved references", () => {
    const input: CreateTransactionInput = { amountKrw: 100, idempotencyKey, occurredOn: "2026-10-16", type: "expense" };
    expect(CreateTransactionInputSchema.parse(input)).toMatchObject({ accountId: null, categoryId: null });
  });

  it("distinguishes omitted edits from explicit clearing and validates counterparty text", () => {
    expect(UpdateTransactionInputSchema.parse({ expectedVersion: 1, accountId: null, categoryId: null, counterpartyName: null })).toEqual({ expectedVersion: 1, accountId: null, categoryId: null, counterpartyName: null });
    expect(UpdateTransactionInputSchema.parse({ expectedVersion: 1, counterpartyName: "  합성 상점  " })).toEqual({ expectedVersion: 1, counterpartyName: "합성 상점" });
    const input = { amountKrw: 100, idempotencyKey, occurredOn: "2026-10-16", type: "expense" };
    expect(CreateTransactionInputSchema.parse({ ...input, counterpartyName: null })).toMatchObject({ counterpartyName: null });
    expect(CreateTransactionInputSchema.parse({ ...input, counterpartyName: "가".repeat(200) })).toHaveProperty("counterpartyName");
    for (const counterpartyName of ["", "   ", "가".repeat(201), "😀".repeat(101)]) {
      expect(() => CreateTransactionInputSchema.parse({ ...input, counterpartyName })).toThrow();
      expect(() => UpdateTransactionInputSchema.parse({ expectedVersion: 1, counterpartyName })).toThrow();
    }
  });

  it.each(["transfer_out", "transfer_in", "opening_balance"])("still requires an account for %s", (kind) => {
    const value = { ...baseTransaction, accountId: null, kind, categoryId: null, transferId: kind === "opening_balance" ? null : transferId, ...(kind === "opening_balance" ? { direction: "asset" } : {}) };
    expect(() => TransactionSchema.parse(value)).toThrow();
  });

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
  it("rejects a same-account transfer even when UUID casing differs", () => {
    expect(() => CreateTransferInputSchema.parse({
      amountKrw: 100,
      fromAccountId: accountId,
      toAccountId: accountId.toUpperCase(),
      idempotencyKey,
      occurredOn: "2026-08-26",
    })).toThrow("TRANSFER_ACCOUNTS_MUST_DIFFER");
  });

  it.each(["id", "accountId"] as const)("rejects transfer results with duplicate %s in different casing", (field) => {
    const debit = { ...baseTransaction, kind: "transfer_out", categoryId: null, transferId };
    const credit = { ...baseTransaction, id: categoryId, accountId: categoryId, kind: "transfer_in", categoryId: null, transferId, [field]: accountId.toUpperCase() };
    expect(() => CreateTransferResultSchema.parse({ debit, credit, transferId })).toThrow("TRANSFER_RESULT_FIELDS_MISMATCH");
  });

  it("accepts matching transfer references with different UUID casing", () => {
    const debit = { ...baseTransaction, kind: "transfer_out", categoryId: null, transferId: transferId.toUpperCase() };
    const credit = { ...baseTransaction, id: categoryId.toUpperCase(), accountId: categoryId.toUpperCase(), kind: "transfer_in", categoryId: null, transferId };
    expect(CreateTransferResultSchema.parse({ debit, credit, transferId })).toMatchObject({
      transferId,
      debit: { transferId },
      credit: { id: categoryId, accountId: categoryId, transferId },
    });
  });

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
      { ...baseTransaction, kind: "opening_balance", categoryId: null, transferId: null, direction: "asset" },
    ]) expect(TransactionSchema.parse(value)).toMatchObject({ kind: value.kind });
    expect(() => TransactionSchema.parse({ ...baseTransaction, kind: "income", categoryId: null, transferId })).toThrow();
    expect(() => TransactionSchema.parse({ ...baseTransaction, kind: "transfer_in", categoryId, transferId: null })).toThrow();
    expect(() => TransactionSchema.parse({ ...baseTransaction, kind: "opening_balance", categoryId, transferId: null })).toThrow();
    expect(TransactionSchema.parse({ ...baseTransaction, kind: "opening_balance", categoryId: null, transferId: null, direction: "liability" })).toMatchObject({ direction: "liability" });
    expect(() => TransactionSchema.parse({ ...baseTransaction, kind: "opening_balance", categoryId: null, transferId: null })).toThrow();
    expect(() => TransactionSchema.parse({ ...baseTransaction, kind: "opening_balance", categoryId: null, transferId: null, direction: "loan" })).toThrow();
  });

  it("validates transfer result, tombstones, and strict bounded lists", () => {
    const debit = { ...baseTransaction, kind: "transfer_out", categoryId: null, transferId };
    const credit = { ...baseTransaction, id: categoryId, accountId: categoryId, kind: "transfer_in", categoryId: null, transferId, memo: null };
    expect(CreateTransferResultSchema.parse({ debit, credit, transferId })).toMatchObject({ transferId });
    expect(() => CreateTransferResultSchema.parse({ debit: credit, credit: debit, transferId })).toThrow();
    expect(() => CreateTransferResultSchema.parse({ debit, credit: { ...credit, transferId: categoryId }, transferId })).toThrow();
    expect(() => CreateTransferResultSchema.parse({ debit, credit: { ...credit, id: accountId }, transferId })).toThrow();
    expect(() => CreateTransferResultSchema.parse({ debit, credit: { ...credit, accountId }, transferId })).toThrow();
    expect(() => CreateTransferResultSchema.parse({ debit, credit: { ...credit, amountKrw: 99 }, transferId })).toThrow();
    expect(() => CreateTransferResultSchema.parse({ debit, credit: { ...credit, occurredOn: "2026-08-27" }, transferId })).toThrow();
    expect(CreateTransferResultSchema.parse({ debit: { ...debit, memo: "same memo" }, credit: { ...credit, memo: "same memo" }, transferId })).toMatchObject({ transferId });
    expect(() => CreateTransferResultSchema.parse({ debit: { ...debit, memo: "debit memo" }, credit: { ...credit, memo: "credit memo" }, transferId })).toThrow();
    expect(TransactionTombstoneSchema.parse({ id: accountId, version: 2, deletedAt: timestamp })).toEqual({ id: accountId, version: 2, deletedAt: timestamp });
    expect(() => TransactionListQuerySchema.parse({ from: "2026-08-27", to: "2026-08-26" })).toThrow();
    expect(() => TransactionListQuerySchema.parse({ nope: true })).toThrow();
    expect(TransactionListResponseSchema.parse({ items: Array.from({ length: 100 }, () => ({ ...baseTransaction, kind: "opening_balance", categoryId: null, transferId: null, direction: "asset" })), nextCursor: null })).toMatchObject({ items: expect.any(Array) });
    expect(() => TransactionListResponseSchema.parse({ items: Array.from({ length: 101 }, () => ({ ...baseTransaction, kind: "opening_balance", categoryId: null, transferId: null, direction: "asset" })), nextCursor: null })).toThrow();
  });
});
