import { z } from "zod";

export const ApiErrorSchema = z.object({
  code: z.enum([
    "AUTH_INVALID_CREDENTIALS",
    "AUTH_EMAIL_VERIFICATION_REQUIRED",
    "AUTH_SESSION_EXPIRED",
    "AUTH_SESSION_REFRESH_REQUIRED",
    "AUTH_CSRF_REJECTED",
    "AUTH_OAUTH_TRANSACTION_INVALID",
    "AUTH_RATE_LIMITED",
    "AUTH_PROVIDER_UNAVAILABLE",
  ]),
  message: z.string().min(1).max(300),
  requestId: z.string().min(8).max(128),
  retryable: z.boolean(),
  fieldErrors: z.array(z.object({ field: z.string(), code: z.string() }).strict()).max(20),
}).strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Parses untrusted public error data, rejecting malformed or unexpected fields. */
export const parseApiError = (input: unknown): ApiError => ApiErrorSchema.parse(input);
