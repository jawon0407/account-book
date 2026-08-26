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

/** Direction prevents clients from encoding liabilities with negative amounts. */
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
