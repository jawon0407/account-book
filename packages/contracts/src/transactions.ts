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
import { OpeningBalanceDirectionSchema } from "./accounts.js";

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

/**
 * 실제 수정 필드가 하나 이상 있어야 한다. refine은 expectedVersion만 있는 빈 수정을 거부한다.
 * memo: null은 메모 삭제 요청이므로 유효하고, 생략(undefined)은 수정하지 않겠다는 뜻이다.
 * 입력 형식 검사만 하며 거래 변경·소유권 조회·버전 충돌 처리는 수행하지 않는다.
 */
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

/**
 * 하나의 이체 요청 계약. refine은 소문자로 정규화된 출발·도착 UUID가 같으면 toAccountId에 오류를 붙인다.
 * 두 거래 행을 함께 저장할 원자적 금융 API는 아직 구현되지 않았다. 이 스키마는 DB에 쓰지 않는다.
 */
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
const OpeningBalanceTransactionSchema = TransactionBaseSchema.extend({ kind: z.literal("opening_balance"), categoryId: z.null(), transferId: z.null(), direction: OpeningBalanceDirectionSchema }).strict();

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

/**
 * 이체 응답의 두 행이 한 쌍인지 검사한다. 첫 refine은 두 행의 transferId와 상위 ID 일치를 확인한다.
 * 두 번째 refine은 행·계좌 ID가 서로 다르고 금액·일자·메모가 같은지 확인한다.
 * parse는 계약에 맞는 결과만 반환하며 불일치는 검증 오류다. 실제 DB 원자성을 증명하지는 않는다.
 */
export const CreateTransferResultSchema = z.object({
  credit: TransferInTransactionSchema,
  debit: TransferOutTransactionSchema,
  transferId: LedgerIdSchema,
}).strict().refine((result) => result.debit.transferId === result.transferId && result.credit.transferId === result.transferId, {
  message: "TRANSFER_RESULT_ID_MISMATCH",
}).refine((result) => result.debit.id !== result.credit.id && result.debit.accountId !== result.credit.accountId && result.debit.amountKrw === result.credit.amountKrw && result.debit.occurredOn === result.credit.occurredOn && result.debit.memo === result.credit.memo, { message: "TRANSFER_RESULT_FIELDS_MISMATCH" });
export type CreateTransferResult = z.infer<typeof CreateTransferResultSchema>;

/**
 * 거래 목록 필터 계약. from과 to가 모두 있을 때 refine이 시작일이 종료일보다 늦은 요청을 거부한다.
 * YYYY-MM-DD로 검증한 문자열은 사전순과 날짜순이 같으므로 문자열 비교가 가능하다.
 * 날짜가 한쪽만 있어도 허용하며 실제 조회·커서 해석·기본 페이지 크기 적용은 수행하지 않는다.
 */
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
