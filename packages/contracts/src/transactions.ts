import { z } from "zod";
import {
  CursorSchema,
  ExpectedVersionSchema,
  IdempotencyKeySchema,
  LedgerIdSchema,
  LocalDateSchema,
  PageSizeSchema,
  PositiveKrwAmountSchema,
  TimestampSchema,
  VersionSchema,
} from "./ledger-common.js";

const MemoSchema = z.string().trim().min(1).max(500);

export const TransactionInputTypeSchema = z.enum(["income", "expense"]);
export type TransactionInputType = z.infer<typeof TransactionInputTypeSchema>;

export const CreateTransactionInputSchema = z.object({
  accountId: LedgerIdSchema,
  amountKrw: PositiveKrwAmountSchema,
  categoryId: LedgerIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  memo: MemoSchema.optional(),
  occurredOn: LocalDateSchema,
  type: TransactionInputTypeSchema,
}).strict();
export type CreateTransactionInput = z.infer<typeof CreateTransactionInputSchema>;

export const UpdateTransactionInputSchema = z.object({
  accountId: LedgerIdSchema.optional(),
  amountKrw: PositiveKrwAmountSchema.optional(),
  categoryId: LedgerIdSchema.optional(),
  expectedVersion: ExpectedVersionSchema,
  memo: MemoSchema.nullable().optional(),
  occurredOn: LocalDateSchema.optional(),
  type: TransactionInputTypeSchema.optional(),
}).strict().refine((input) =>
  input.accountId !== undefined || input.amountKrw !== undefined || input.categoryId !== undefined ||
  input.memo !== undefined || input.occurredOn !== undefined || input.type !== undefined,
{ message: "TRANSACTION_UPDATE_EMPTY" });
export type UpdateTransactionInput = z.infer<typeof UpdateTransactionInputSchema>;

export const DeleteTransactionInputSchema = z.object({ expectedVersion: ExpectedVersionSchema }).strict();
export type DeleteTransactionInput = z.infer<typeof DeleteTransactionInputSchema>;

/** One logical transfer command; the API must create both ledger rows atomically. */
export const CreateTransferInputSchema = z.object({
  amountKrw: PositiveKrwAmountSchema,
  fromAccountId: LedgerIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  memo: MemoSchema.optional(),
  occurredOn: LocalDateSchema,
  toAccountId: LedgerIdSchema,
}).strict().refine((input) => input.fromAccountId !== input.toAccountId, {
  message: "TRANSFER_ACCOUNTS_MUST_DIFFER",
  path: ["toAccountId"],
});
export type CreateTransferInput = z.infer<typeof CreateTransferInputSchema>;

const TransactionBaseSchema = z.object({
  id: LedgerIdSchema,
  accountId: LedgerIdSchema,
  amountKrw: PositiveKrwAmountSchema,
  occurredOn: LocalDateSchema,
  memo: z.string().nullable(),
  version: VersionSchema,
  deletedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

const IncomeTransactionSchema = TransactionBaseSchema.extend({ kind: z.literal("income"), categoryId: LedgerIdSchema, transferId: z.null() }).strict();
const ExpenseTransactionSchema = TransactionBaseSchema.extend({ kind: z.literal("expense"), categoryId: LedgerIdSchema, transferId: z.null() }).strict();
export const TransferOutTransactionSchema = TransactionBaseSchema.extend({ kind: z.literal("transfer_out"), categoryId: z.null(), transferId: LedgerIdSchema }).strict();
export type TransferOutTransaction = z.infer<typeof TransferOutTransactionSchema>;
export const TransferInTransactionSchema = TransactionBaseSchema.extend({ kind: z.literal("transfer_in"), categoryId: z.null(), transferId: LedgerIdSchema }).strict();
export type TransferInTransaction = z.infer<typeof TransferInTransactionSchema>;
const OpeningBalanceTransactionSchema = TransactionBaseSchema.extend({ kind: z.literal("opening_balance"), categoryId: z.null(), transferId: z.null() }).strict();

export const TransactionSchema = z.discriminatedUnion("kind", [
  IncomeTransactionSchema,
  ExpenseTransactionSchema,
  TransferOutTransactionSchema,
  TransferInTransactionSchema,
  OpeningBalanceTransactionSchema,
]);
export type Transaction = z.infer<typeof TransactionSchema>;

export const TransactionTombstoneSchema = z.object({ id: LedgerIdSchema, version: VersionSchema, deletedAt: TimestampSchema }).strict();
export type TransactionTombstone = z.infer<typeof TransactionTombstoneSchema>;

export const CreateTransferResultSchema = z.object({
  credit: TransferInTransactionSchema,
  debit: TransferOutTransactionSchema,
  transferId: LedgerIdSchema,
}).strict();
export type CreateTransferResult = z.infer<typeof CreateTransferResultSchema>;

export const TransactionListQuerySchema = z.object({
  accountId: LedgerIdSchema.optional(),
  categoryId: LedgerIdSchema.optional(),
  cursor: CursorSchema.optional(),
  from: LocalDateSchema.optional(),
  limit: PageSizeSchema.optional(),
  to: LocalDateSchema.optional(),
  type: z.enum(["income", "expense", "transfer_out", "transfer_in", "opening_balance"]).optional(),
}).strict().refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
  message: "TRANSACTION_QUERY_FROM_AFTER_TO",
  path: ["from"],
});
export type TransactionListQuery = z.infer<typeof TransactionListQuerySchema>;

export const TransactionListResponseSchema = z.object({
  items: z.array(TransactionSchema).max(100),
  nextCursor: CursorSchema.nullable(),
}).strict();
export type TransactionListResponse = z.infer<typeof TransactionListResponseSchema>;
