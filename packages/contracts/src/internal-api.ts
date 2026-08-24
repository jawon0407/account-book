import { z } from "zod";

export const DELEGATED_JWT_ISSUER = "urn:account-book:bff";
export const DELEGATED_JWT_AUDIENCE = "urn:account-book:api";
export const DELEGATED_JWT_TTL_SECONDS = 30;
export const DELEGATED_JWT_REPLAY_SECONDS = 45;
export const DELEGATED_JWT_MAX_BYTES = 4096;

/** Single JSON body limit for Fastify's parser and guard, keeping their validation boundary aligned. */
export const DELEGATED_JSON_BODY_MAX_BYTES = 32_768;

/** Restricts `scope` to the least-privilege capability the BFF may exercise, not a general user role. */
export const DelegatedScopeSchema = z.enum([
  "me:read",
  "account:read",
  "account:write",
  "category:read",
  "category:write",
  "transaction:read",
  "transaction:write",
  "dashboard:read",
]);
export type DelegatedScope = z.infer<typeof DelegatedScopeSchema>;

const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DigestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const RequestIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
);

export type DelegatedRequestInput = Readonly<{
  method: z.infer<typeof MethodSchema>;
  target: string;
  contentType: string | null;
  bodySha256: string;
  requestId: string;
}>;

function invalid(): never {
  throw new Error("DELEGATED_REQUEST_INVALID");
}

/**
 * Normalizes the only content types accepted by protected internal APIs to prevent ambiguous request bindings.
 * @param value Raw `Content-Type` header value, or `null` when the header is absent.
 * @returns The canonical content type used in the delegated request binding.
 */
export function normalizeDelegatedContentType(value: string | null): "" | "application/json" {
  if (value === null) return "";
  if (Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return invalid();
  const normalized = value.trim().toLowerCase();
  if (normalized === "application/json" || normalized === "application/json; charset=utf-8") return "application/json";
  return invalid();
}

/**
 * Builds the cross-runtime request-binding string without hashing or reading secrets, rejecting ambiguous inputs.
 * @param input Validated request data to bind to a delegated JWT.
 * @returns The newline-delimited canonical request representation.
 */
export function canonicalDelegatedRequest(input: DelegatedRequestInput): string {
  const method = MethodSchema.safeParse(input.method);
  const digest = DigestSchema.safeParse(input.bodySha256);
  const requestId = RequestIdSchema.safeParse(input.requestId);
  if (!method.success || !digest.success || !requestId.success || !input.target.startsWith("/")) return invalid();
  let url: URL;
  try {
    url = new URL(input.target, "https://internal.invalid");
  } catch {
    return invalid();
  }
  if (url.origin !== "https://internal.invalid" || url.hash !== "" || url.username !== "" || url.password !== "") return invalid();
  url.searchParams.sort();
  const query = url.searchParams.toString();
  const target = `${url.pathname}${query === "" ? "" : `?${query}`}`;
  return [method.data, target, normalizeDelegatedContentType(input.contentType), digest.data, requestId.data].join("\n");
}
