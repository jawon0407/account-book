import { z } from "zod";

/** Identifies a server-created ledger resource; authorization still comes from the authenticated principal. */
export const LedgerIdSchema = z.uuid();
export type LedgerId = z.infer<typeof LedgerIdSchema>;

/**
 * Identifies one client create attempt so retries can return the original result.
 * It is not a credential and must later be scoped by user, operation, and request fingerprint.
 */
export const IdempotencyKeySchema = z.uuidv4();
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/** Keeps JSON money exact across web, API, and mobile runtimes while rejecting signs and fractions. */
export const PositiveKrwAmountSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export type PositiveKrwAmount = z.infer<typeof PositiveKrwAmountSchema>;

/** Represents computed balances, including liabilities, without exceeding exact JavaScript integers. */
export const SignedKrwBalanceSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export type SignedKrwBalance = z.infer<typeof SignedKrwBalanceSchema>;

/** Preserves the user-selected calendar day without timezone conversion. */
export const LocalDateSchema = z.iso.date();
export type LocalDate = z.infer<typeof LocalDateSchema>;

/** Validates server event timestamps; persistence normalizes accepted offsets to UTC. */
export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Guards optimistic concurrency with a server-issued positive integer. */
export const VersionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const ExpectedVersionSchema = VersionSchema;
export type Version = z.infer<typeof VersionSchema>;
export type ExpectedVersion = z.infer<typeof ExpectedVersionSchema>;

/** Carries a server-issued cursor that clients store and return without parsing. */
export const CursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u);
export type Cursor = z.infer<typeof CursorSchema>;

/** Bounds one ledger page; the API applies its default when this input is absent. */
export const PageSizeSchema = z.number().int().min(1).max(100);
export type PageSize = z.infer<typeof PageSizeSchema>;