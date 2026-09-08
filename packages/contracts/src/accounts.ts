import { z } from "zod";
import {
  IdempotencyKeySchema,
  LedgerIdSchema,
  LocalDateSchema,
  PositiveKrwAmountSchema,
  SignedKrwBalanceSchema,
  TimestampSchema,
  ExpectedVersionSchema,
  VersionSchema,
} from "./ledger-common.js";

export const AccountNameSchema = z.string().trim().min(1).max(80);
export type AccountName = z.infer<typeof AccountNameSchema>;

export const AccountKindSchema = z.enum(["cash", "bank", "card"]);
export type AccountKind = z.infer<typeof AccountKindSchema>;

export const OpeningBalanceDirectionSchema = z.enum(["asset", "liability"]);
export type OpeningBalanceDirection = z.infer<typeof OpeningBalanceDirectionSchema>;

export const CreateAccountInputSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  kind: AccountKindSchema,
  name: AccountNameSchema,
}).strict();
export type CreateAccountInput = z.infer<typeof CreateAccountInputSchema>;

/**
 * 계좌 이름 변경 입력을 검사한다. refine은 expectedVersion만 있고 실제 변경값이 없는 요청을 거부한다.
 * parse 성공 시 정리된 입력을 반환하며 이름이 없으면 ACCOUNT_UPDATE_EMPTY 검증 오류를 만든다.
 * 버전 일치나 계좌 소유권 확인은 향후 금융 API의 책임이다.
 */
export const UpdateAccountInputSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  name: AccountNameSchema.optional(),
}).strict().refine((input) => input.name !== undefined, {
  message: "ACCOUNT_UPDATE_EMPTY",
});
export type UpdateAccountInput = z.infer<typeof UpdateAccountInputSchema>;

export const ArchiveAccountInputSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
}).strict();
export type ArchiveAccountInput = z.infer<typeof ArchiveAccountInputSchema>;

/** 양수 금액과 자산/부채 방향을 분리한 시작 잔액 입력 계약. 실제 잔액을 기록하는 기능은 아니다. */
export const SetOpeningBalanceInputSchema = z.object({
  accountId: LedgerIdSchema,
  amountKrw: PositiveKrwAmountSchema,
  direction: OpeningBalanceDirectionSchema,
  idempotencyKey: IdempotencyKeySchema,
  occurredOn: LocalDateSchema,
}).strict();
export type SetOpeningBalanceInput = z.infer<typeof SetOpeningBalanceInputSchema>;

export const AccountSchema = z.object({
  archivedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  currentBalanceKrw: SignedKrwBalanceSchema,
  id: LedgerIdSchema,
  kind: AccountKindSchema,
  name: AccountNameSchema,
  updatedAt: TimestampSchema,
  version: VersionSchema,
}).strict();
export type Account = z.infer<typeof AccountSchema>;

export const AccountListQuerySchema = z.object({
  includeArchived: z.boolean().optional(),
}).strict();
export type AccountListQuery = z.infer<typeof AccountListQuerySchema>;

export const AccountListResponseSchema = z.object({
  items: z.array(AccountSchema),
}).strict();
export type AccountListResponse = z.infer<typeof AccountListResponseSchema>;
