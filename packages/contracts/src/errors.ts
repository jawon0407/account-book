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



const PublicErrorMessages: Record<ApiErrorCode, string> = {
  AUTH_INVALID_CREDENTIALS: "The authentication input was rejected.",
  AUTH_EMAIL_VERIFICATION_REQUIRED: "Email verification is required.",
  AUTH_SESSION_EXPIRED: "The session has expired.",
  AUTH_SESSION_REFRESH_REQUIRED: "The session must be refreshed.",
  AUTH_CSRF_REJECTED: "The request could not be verified.",
  AUTH_OAUTH_TRANSACTION_INVALID: "The authentication transaction is invalid.",
  AUTH_RATE_LIMITED: "Too many authentication attempts.",
  AUTH_PROVIDER_UNAVAILABLE: "The authentication service is unavailable.",
  LEDGER_VALIDATION_FAILED: "The ledger request is invalid.",
  LEDGER_NOT_FOUND: "The requested ledger resource was not found.",
  LEDGER_VERSION_CONFLICT: "The ledger resource changed; reload and try again.",
  LEDGER_IDEMPOTENCY_CONFLICT: "This request was already processed differently.",
  LEDGER_ACCOUNT_UNAVAILABLE: "The requested account is unavailable.",
  LEDGER_CATEGORY_UNAVAILABLE: "The requested category is unavailable.",
  LEDGER_TRANSFER_INVALID: "The transfer request is invalid.",
};

const PublicFieldErrorFields = z.enum(["email", "password", "returnPath", "provider", "accountId", "categoryId", "occurredOn", "type", "memo", "expectedVersion", "fromAccountId", "toAccountId"]);
const PublicFieldErrorCodes = z.enum(["INVALID", "REQUIRED", "TOO_SHORT", "TOO_LONG", "INVALID_FORMAT", "CONFLICT"]);
const PublicFieldErrorSchema = z.object({ field: z.string(), code: z.string() }).strict();

const ApiErrorInputSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string().min(1).max(300),
  requestId: z.string().min(8).max(128),
  retryable: z.boolean(),
  fieldErrors: z.array(PublicFieldErrorSchema).max(20).transform((errors) => errors.flatMap((error) => {
    const field = PublicFieldErrorFields.safeParse(error.field);
    const code = PublicFieldErrorCodes.safeParse(error.code);
    return field.success && code.success ? [{ field: field.data, code: code.data }] : [];
  })),
}).strict();

export const ApiErrorSchema = ApiErrorInputSchema.transform((error) => ({
  ...error,
  message: PublicErrorMessages[error.code],
}));
export type ApiError = z.infer<typeof ApiErrorSchema>;
/** Parses untrusted public error data, rejecting malformed or unexpected fields. */
export const parseApiError = (input: unknown): ApiError => ApiErrorSchema.parse(input);
