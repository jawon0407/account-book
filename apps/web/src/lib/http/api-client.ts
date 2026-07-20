import { ApiErrorSchema, type ApiError } from "@account-book/contracts";
import ky from "ky";

export const apiClient = ky.create({
  prefix: "/api",
  credentials: "same-origin",
  retry: { limit: 0 },
  timeout: 10_000,
  headers: { accept: "application/json" },
});

/** Minimal ky-compatible response promise used by injectable browser tests. */
export type JsonResult = Readonly<{ json<T = unknown>(): Promise<T> }>;

/** Relative same-origin HTTP surface accepted by auth query helpers. */
export type BrowserApiClient = Readonly<{
  get(path: string): JsonResult;
  post(path: string, options: Readonly<{ json: unknown; headers: Readonly<Record<string, string>> }>): JsonResult;
}>;

/** A strictly parsed public API error without the original exception or response payload. */
export class ApiClientError extends Error {
  /**
   * Keeps only the validated public envelope.
   * @param envelope - Strict same-origin `ApiError` data safe for UI decisions.
   */
  public constructor(public readonly envelope: ApiError) {
    super(envelope.message);
    this.name = "ApiClientError";
  }

  public get code(): ApiError["code"] { return this.envelope.code; }
  public get retryable(): boolean { return this.envelope.retryable; }
}

/**
 * Converts an unknown ky failure into a strict public error and drops untrusted details.
 * @param error - A caught browser request failure, optionally carrying a `Response`.
 * @returns A validated error suitable for control flow.
 */
export async function apiError(error: unknown): Promise<ApiClientError> {
  if (error instanceof ApiClientError) return error;
  const response = error !== null && typeof error === "object" ? (error as { response?: unknown }).response : undefined;
  if (response instanceof Response) {
    try {
      const parsed = ApiErrorSchema.safeParse(await response.clone().json());
      if (parsed.success) return new ApiClientError(parsed.data);
    } catch {
      // Fall through to a fixed local error.
    }
  }
  return new ApiClientError({
    code: "AUTH_PROVIDER_UNAVAILABLE",
    message: "The authentication service is unavailable.",
    requestId: "browser-request-error",
    retryable: false,
    fieldErrors: [],
  });
}
