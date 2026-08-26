import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_EMAIL_VERIFICATION_REQUIRED",
  "AUTH_SESSION_EXPIRED",
  "AUTH_SESSION_REFRESH_REQUIRED",
  "AUTH_CSRF_REJECTED",
  "AUTH_OAUTH_TRANSACTION_INVALID",
  "AUTH_RATE_LIMITED",
  "AUTH_PROVIDER_UNAVAILABLE",
  "LEDGER_VALIDATION_FAILED",
  "LEDGER_NOT_FOUND",
  "LEDGER_VERSION_CONFLICT",
  "LEDGER_IDEMPOTENCY_CONFLICT",
  "LEDGER_ACCOUNT_UNAVAILABLE",
  "LEDGER_CATEGORY_UNAVAILABLE",
  "LEDGER_TRANSFER_INVALID",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;



export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string().min(1).max(300),
  requestId: z.string().min(8).max(128),
  retryable: z.boolean(),
  fieldErrors: z.array(z.object({ field: z.string(), code: z.string() }).strict()).max(20),
}).strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Parses untrusted public error data, rejecting malformed or unexpected fields. */
export const parseApiError = (input: unknown): ApiError => ApiErrorSchema.parse(input);
