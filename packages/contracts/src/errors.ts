import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "AUTH_INVALID_CREDENTIALS", "AUTH_EMAIL_VERIFICATION_REQUIRED", "AUTH_SESSION_EXPIRED", "AUTH_SESSION_REFRESH_REQUIRED", "AUTH_CSRF_REJECTED", "AUTH_OAUTH_TRANSACTION_INVALID", "AUTH_RATE_LIMITED", "AUTH_PROVIDER_UNAVAILABLE",
  "LEDGER_VALIDATION_FAILED", "LEDGER_NOT_FOUND", "LEDGER_VERSION_CONFLICT", "LEDGER_IDEMPOTENCY_CONFLICT", "LEDGER_ACCOUNT_UNAVAILABLE", "LEDGER_CATEGORY_UNAVAILABLE", "LEDGER_TRANSFER_INVALID",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const PublicErrorMessages = {
  AUTH_INVALID_CREDENTIALS: "The authentication input was rejected.", AUTH_EMAIL_VERIFICATION_REQUIRED: "Email verification is required.", AUTH_SESSION_EXPIRED: "The session has expired.", AUTH_SESSION_REFRESH_REQUIRED: "The session must be refreshed.", AUTH_CSRF_REJECTED: "The request could not be verified.", AUTH_OAUTH_TRANSACTION_INVALID: "The authentication transaction is invalid.", AUTH_RATE_LIMITED: "Too many authentication attempts.", AUTH_PROVIDER_UNAVAILABLE: "The authentication service is unavailable.",
  LEDGER_VALIDATION_FAILED: "The ledger request is invalid.", LEDGER_NOT_FOUND: "The requested ledger resource was not found.", LEDGER_VERSION_CONFLICT: "The ledger resource changed; reload and try again.", LEDGER_IDEMPOTENCY_CONFLICT: "This request was already processed differently.", LEDGER_ACCOUNT_UNAVAILABLE: "The requested account is unavailable.", LEDGER_CATEGORY_UNAVAILABLE: "The requested category is unavailable.", LEDGER_TRANSFER_INVALID: "The transfer request is invalid.",
} as const satisfies Record<ApiErrorCode, string>;

export const PublicFieldErrorFields = z.enum(["email", "password", "returnPath", "provider", "accountId", "amountKrw", "categoryId", "idempotencyKey", "kind", "name", "expectedVersion", "direction", "occurredOn", "includeArchived", "sortOrder", "fromAccountId", "memo", "toAccountId", "type", "cursor", "limit", "from", "to"]);
export const PublicFieldErrorCodes = z.enum(["INVALID", "REQUIRED", "TOO_SHORT", "TOO_LONG", "INVALID_FORMAT", "CONFLICT"]);
const PublicFieldErrorSchema = z.object({ field: PublicFieldErrorFields, code: PublicFieldErrorCodes }).strict();
const RequestIdSchema = z.uuid();

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string(),
  requestId: RequestIdSchema,
  retryable: z.boolean(),
  fieldErrors: z.array(PublicFieldErrorSchema).max(20),
}).strict().superRefine((error, context) => {
  if (error.message !== PublicErrorMessages[error.code]) context.addIssue({ code: z.ZodIssueCode.custom, path: ["message"], message: "message must match its error code" });
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

type BuilderInput = Readonly<{ code: ApiErrorCode; message?: unknown; requestId?: unknown; retryable: boolean; fieldErrors?: unknown }>;

function freshRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (character) => { const value = Math.floor(Math.random() * 16); return (character === "x" ? value : (value & 3) | 8).toString(16); });
}

export function buildApiError(input: BuilderInput): ApiError {
  const code = ApiErrorCodeSchema.parse(input.code);
  const requestId = typeof input.requestId === "string" && RequestIdSchema.safeParse(input.requestId).success ? input.requestId : "00000000-0000-4000-8000-000000000000";
  const fieldErrors = Array.isArray(input.fieldErrors) ? input.fieldErrors.flatMap((value) => {
    if (value === null || typeof value !== "object") return [];
    const candidate = value as { field?: unknown; code?: unknown };
    const field = PublicFieldErrorFields.safeParse(candidate.field);
    const fieldCode = PublicFieldErrorCodes.safeParse(candidate.code);
    return field.success && fieldCode.success ? [{ field: field.data, code: fieldCode.data }] : [];
  }).slice(0, 20) : [];
  return ApiErrorSchema.parse({ code, message: PublicErrorMessages[code], requestId, retryable: input.retryable, fieldErrors });
}

/** Converts an untrusted candidate into a strict public envelope before it reaches a response writer. */
export function sanitizeApiErrorInput(input: unknown): ApiError {
  if (input === null || typeof input !== "object") return buildApiError({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true });
  const candidate = input as { code?: unknown; message?: unknown; requestId?: unknown; retryable?: unknown; fieldErrors?: unknown };
  const code = ApiErrorCodeSchema.safeParse(candidate.code);
  return buildApiError({ code: code.success ? code.data : "AUTH_PROVIDER_UNAVAILABLE", message: candidate.message, requestId: candidate.requestId, retryable: candidate.retryable === true, fieldErrors: candidate.fieldErrors });
}

/** Parses already-sanitized public wire data; it never repairs or normalizes input. */
export const parseApiError = (input: unknown): ApiError => ApiErrorSchema.parse(input);