import { z } from "zod";
import { apiClient, type BrowserApiClient } from "./api-client.js";

const CsrfResponseSchema = z.object({ csrfToken: z.string().min(1).max(1024) }).strict();
const MUTATION_PATHS = new Set([
  "auth/sign-up",
  "auth/sign-in",
  "auth/oauth/google/start",
  "auth/oauth/kakao/start",
  "auth/oauth/naver/start",
  "auth/session/refresh",
  "auth/sign-out",
  "auth/password/reset-request",
  "auth/password/update",
]);

function client(value: BrowserApiClient | typeof apiClient): BrowserApiClient {
  return value as unknown as BrowserApiClient;
}

/** Fetches a short-lived CSRF token without persisting it outside the current call. */
export async function getCsrfToken(http: BrowserApiClient | typeof apiClient = apiClient, context: "default" | "interaction" = "default"): Promise<string> {
  const path = context === "interaction" ? "auth/csrf?context=interaction" : "auth/csrf";
  const parsed = CsrfResponseSchema.safeParse(await client(http).get(path).json<unknown>());
  if (!parsed.success) throw new Error("AUTH_RESPONSE_INVALID");
  return parsed.data.csrfToken;
}

/**
 * Sends one allowlisted mutation with a newly fetched CSRF token and no automatic retry.
 * @param path - A fixed relative authentication mutation path; absolute or unknown paths fail closed.
 * @param json - Contract input serialized by ky as JSON.
 * @param http - Same-origin client seam; defaults to the single configured ky instance.
 * @returns The untrusted JSON payload for endpoint-specific schema validation.
 */
export async function postWithCsrf(path: string, json: unknown, http: BrowserApiClient | typeof apiClient = apiClient): Promise<unknown> {
  if (!MUTATION_PATHS.has(path)) throw new Error("AUTH_CLIENT_PATH_INVALID");
  const csrfToken = await getCsrfToken(http, path === "auth/password/update" ? "interaction" : "default");
  return client(http).post(path, { json, headers: { "X-CSRF-Token": csrfToken } }).json<unknown>();
}
