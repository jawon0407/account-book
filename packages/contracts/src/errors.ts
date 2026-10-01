import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "PROFILE_VALIDATION_FAILED", "PROFILE_VERSION_CONFLICT", "LEDGER_SERVICE_UNAVAILABLE",
  "AUTH_INVALID_CREDENTIALS", "AUTH_EMAIL_VERIFICATION_REQUIRED", "AUTH_SESSION_EXPIRED", "AUTH_SESSION_REFRESH_REQUIRED", "AUTH_CSRF_REJECTED", "AUTH_OAUTH_TRANSACTION_INVALID", "AUTH_RATE_LIMITED", "AUTH_PROVIDER_UNAVAILABLE",
  "LEDGER_VALIDATION_FAILED", "LEDGER_NOT_FOUND", "LEDGER_VERSION_CONFLICT", "LEDGER_IDEMPOTENCY_CONFLICT", "LEDGER_ACCOUNT_UNAVAILABLE", "LEDGER_CATEGORY_UNAVAILABLE", "LEDGER_TRANSFER_INVALID",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const PublicErrorMessages = {
  PROFILE_VALIDATION_FAILED: "The profile request is invalid.", PROFILE_VERSION_CONFLICT: "The profile changed; reload and try again.", LEDGER_SERVICE_UNAVAILABLE: "The ledger service is unavailable.",
  AUTH_INVALID_CREDENTIALS: "The authentication input was rejected.", AUTH_EMAIL_VERIFICATION_REQUIRED: "Email verification is required.", AUTH_SESSION_EXPIRED: "The session has expired.", AUTH_SESSION_REFRESH_REQUIRED: "The session must be refreshed.", AUTH_CSRF_REJECTED: "The request could not be verified.", AUTH_OAUTH_TRANSACTION_INVALID: "The authentication transaction is invalid.", AUTH_RATE_LIMITED: "Too many authentication attempts.", AUTH_PROVIDER_UNAVAILABLE: "The authentication service is unavailable.",
  LEDGER_VALIDATION_FAILED: "The ledger request is invalid.", LEDGER_NOT_FOUND: "The requested ledger resource was not found.", LEDGER_VERSION_CONFLICT: "The ledger resource changed; reload and try again.", LEDGER_IDEMPOTENCY_CONFLICT: "This request was already processed differently.", LEDGER_ACCOUNT_UNAVAILABLE: "The requested account is unavailable.", LEDGER_CATEGORY_UNAVAILABLE: "The requested category is unavailable.", LEDGER_TRANSFER_INVALID: "The transfer request is invalid.",
} as const satisfies Record<ApiErrorCode, string>;

export const PublicFieldErrorFields = z.enum(["email", "password", "returnPath", "provider", "accountId", "amountKrw", "categoryId", "idempotencyKey", "kind", "name", "expectedVersion", "direction", "occurredOn", "includeArchived", "sortOrder", "fromAccountId", "memo", "toAccountId", "type", "cursor", "limit", "from", "to"]);
export const PublicFieldErrorCodes = z.enum(["INVALID", "REQUIRED", "TOO_SHORT", "TOO_LONG", "INVALID_FORMAT", "CONFLICT"]);
const PublicFieldErrorSchema = z.object({ field: PublicFieldErrorFields, code: PublicFieldErrorCodes }).strict();
const RequestIdSchema = z.uuid();

/**
 * 외부에 보낼 오류의 필드와 개수를 제한한다. superRefine은 코드에 대응하는 고정 문구인지도 검사한다.
 * 문구를 자유롭게 받지 않으므로 내부 예외나 비밀값이 메시지에 섞이는 것을 막는다.
 */
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

/**
 * 오류를 추적할 새 UUID를 만든다. 가능하면 Web Crypto, 없으면 Math.random 기반 대체 경로를 쓴다.
 * @returns UUID 모양의 추적 문자열. 인증 토큰이나 암호학적 비밀값으로 사용하지 않는다.
 */
function freshRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (character) => { const value = Math.floor(Math.random() * 16); return (character === "x" ? value : (value & 3) | 8).toString(16); });
}

/**
 * 오류 코드를 기준으로 고정 메시지를 선택하고 허용된 필드 오류만 최대 20개 남긴다.
 * @param input - 코드, 재시도 여부와 선택적인 요청 ID·필드 오류. message는 의도적으로 무시한다.
 * @returns 공유 스키마까지 검증된 공개 오류 객체. 요청 ID가 부적절하면 새 ID를 만든다.
 * @throws 코드나 최종 응답이 스키마에 맞지 않으면 Zod 검증 오류.
 */
export function buildApiError(input: BuilderInput): ApiError {
  const code = ApiErrorCodeSchema.parse(input.code);
  const requestId = typeof input.requestId === "string" && RequestIdSchema.safeParse(input.requestId).success ? input.requestId : freshRequestId();
  const fieldErrors = Array.isArray(input.fieldErrors) ? input.fieldErrors.flatMap((value) => {
    if (value === null || typeof value !== "object") return [];
    const candidate = value as { field?: unknown; code?: unknown };
    const field = PublicFieldErrorFields.safeParse(candidate.field);
    const fieldCode = PublicFieldErrorCodes.safeParse(candidate.code);
    return field.success && fieldCode.success ? [{ field: field.data, code: fieldCode.data }] : [];
  }).slice(0, 20) : [];
  return ApiErrorSchema.parse({ code, message: PublicErrorMessages[code], requestId, retryable: input.retryable, fieldErrors });
}

/**
 * 신뢰하지 않는 오류 후보를 공개 응답 형태로 정리하고 알 수 없는 코드는 고정 장애 코드로 바꾼다.
 * @param input - 임의의 입력. 객체가 아니면 재시도 가능한 인증 제공자 장애로 처리한다.
 * @returns 내부 문구와 허용되지 않은 필드가 제거된 ApiError. 입력 객체는 변경하지 않는다.
 */
export function sanitizeApiErrorInput(input: unknown): ApiError {
  if (input === null || typeof input !== "object") return buildApiError({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true });
  const candidate = input as { code?: unknown; message?: unknown; requestId?: unknown; retryable?: unknown; fieldErrors?: unknown };
  const code = ApiErrorCodeSchema.safeParse(candidate.code);
  return buildApiError({ code: code.success ? code.data : "AUTH_PROVIDER_UNAVAILABLE", message: candidate.message, requestId: candidate.requestId, retryable: candidate.retryable === true, fieldErrors: candidate.fieldErrors });
}

/**
 * 이미 정리된 공개 오류 응답을 엄격하게 검사한다. 잘못된 값을 보정하지 않는다.
 * @param input - 네트워크 등에서 받은 오류 응답 후보.
 * @returns 고정 메시지까지 공유 계약에 맞는 ApiError.
 * @throws 알 수 없는 필드나 잘못된 값이 있으면 Zod 검증 오류.
 */
export const parseApiError = (input: unknown): ApiError => ApiErrorSchema.parse(input);
