export type CredentialScanOptions = Readonly<{
  allowCsrfTokenKey?: boolean;
  publicEmail?: string;
}>;

export type SafeJsonParseResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false }>;

type AuthErrorCode = "AUTH_INVALID_CREDENTIALS" | "AUTH_SESSION_EXPIRED";

const authErrorMessages: Readonly<Record<AuthErrorCode, string>> = {
  AUTH_INVALID_CREDENTIALS: "The authentication input was rejected.",
  AUTH_SESSION_EXPIRED: "The session has expired.",
};
const compactJwt = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u;
const credentialLabel = /access.?token|refresh.?token|password|session.?selector|selector/iu;
const credentialOrCsrfLabel = /access.?token|refresh.?token|csrf.?token|password|session.?selector|selector/iu;
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Detects raw credential values and labels before assertions can echo a response.
 * The one public sign-in email and a CSRF endpoint's own key may be explicitly
 * allowed; parsed-value scanning still constrains their exact locations.
 * @param value - Response text retained only inside the current test process.
 * @param forbidden - Exact synthetic or live secrets known before this response.
 * @param options - Narrow endpoint-specific allowances validated again after parsing.
 * @returns True when raw text contains forbidden credential material.
 */
export function containsCredentialMaterial(
  value: string,
  forbidden: readonly string[] = [],
  options: CredentialScanOptions = {},
): boolean {
  const exactSecrets = forbidden.filter(
    (secret) => secret.length > 0 && secret !== options.publicEmail,
  );
  const labels = options.allowCsrfTokenKey === true ? credentialLabel : credentialOrCsrfLabel;
  return exactSecrets.some((secret) => value.includes(secret))
    || labels.test(value)
    || compactJwt.test(value);
}

/**
 * Recursively detects encoded/nested credentials while allowing only `user.email`
 * to carry the expected public email and only a root CSRF key when requested.
 * @param value - Safely parsed JSON value that is never passed to an assertion diff.
 * @param forbidden - Exact synthetic or live secrets known before this response.
 * @param options - Narrow path allowances for the public sign-in/CSRF contracts.
 * @returns True when a key or value contains forbidden credential material.
 */
export function containsCredentialMaterialInJson(
  value: unknown,
  forbidden: readonly string[] = [],
  options: CredentialScanOptions = {},
): boolean {
  return scanJsonValue(value, forbidden, options, []);
}

/**
 * Parses JSON without allowing parser messages to retain hostile response snippets.
 * @param value - Response text already checked for known credential material.
 * @returns A discriminated success value or a fixed boolean-safe failure.
 */
export function parseJsonSafely(value: string): SafeJsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Validates the exact one-key CSRF public contract with no assertion diff.
 * @param value - Safely parsed CSRF response.
 * @returns True only for one bounded non-empty `csrfToken` string.
 */
export function isCsrfResponse(value: unknown): value is Readonly<{ csrfToken: string }> {
  return hasExactKeys(value, ["csrfToken"])
    && typeof value.csrfToken === "string"
    && value.csrfToken.length >= 1
    && value.csrfToken.length <= 1024;
}

/**
 * Validates an exact fixed auth-error envelope without exposing received fields.
 * @param value - Safely parsed public error response.
 * @param code - Fixed error code expected for the exercised branch.
 * @returns True only for the fixed message, UUID, retryability, and empty errors.
 */
export function isAuthErrorResponse(value: unknown, code: AuthErrorCode): boolean {
  return hasExactKeys(value, ["code", "fieldErrors", "message", "requestId", "retryable"])
    && value.code === code
    && value.message === authErrorMessages[code]
    && typeof value.requestId === "string"
    && canonicalUuid.test(value.requestId)
    && value.retryable === false
    && Array.isArray(value.fieldErrors)
    && value.fieldErrors.length === 0;
}

/**
 * Validates the exact nested public session contract using fixed booleans only.
 * @param value - Safely parsed successful sign-in response.
 * @param expected - Synthetic public identity expected from the test IDP.
 * @returns True only for exact keys, identity, verification, and ordered ISO expiries.
 */
export function isSignInResponse(
  value: unknown,
  expected: Readonly<{ email: string; userId: string }>,
): boolean {
  if (!hasExactKeys(value, ["absoluteExpiresAt", "expiresAt", "user"])) return false;
  if (!hasExactKeys(value.user, ["email", "emailVerified", "id"])) return false;
  if (
    value.user.email !== expected.email
    || value.user.emailVerified !== true
    || value.user.id !== expected.userId
  ) {
    return false;
  }
  if (!isCanonicalIsoDate(value.expiresAt) || !isCanonicalIsoDate(value.absoluteExpiresAt)) return false;
  return Date.parse(value.absoluteExpiresAt) > Date.parse(value.expiresAt);
}

/**
 * Validates the exact nested `/api/me` public identity without diffing its object.
 * @param value - Safely parsed current-user response.
 * @param expected - Fixed public identity fields expected from the API boundary.
 * @returns True only for the three exact keys and expected primitive values.
 */
export function isMeResponse(
  value: unknown,
  expected: Readonly<{ email: string | null; userId: string }>,
): boolean {
  return hasExactKeys(value, ["email", "emailVerified", "id"])
    && value.email === expected.email
    && value.emailVerified === true
    && value.id === expected.userId;
}

/**
 * Validates the exact logout acknowledgement without diffing received JSON.
 * @param value - Safely parsed sign-out response.
 * @returns True only for the single fixed `signedOut: true` field.
 */
export function isSignOutResponse(value: unknown): boolean {
  return hasExactKeys(value, ["signedOut"]) && value.signedOut === true;
}

/**
 * Recursively scans JSON paths so nested or escaped secrets cannot bypass raw text checks.
 * @param value - Current parsed JSON value.
 * @param forbidden - Exact secrets known to the calling response boundary.
 * @param options - Endpoint-specific public email or CSRF-key allowance.
 * @param path - Current object path, retained only as fixed property names.
 * @returns True when the current value or a descendant contains credential material.
 */
function scanJsonValue(
  value: unknown,
  forbidden: readonly string[],
  options: CredentialScanOptions,
  path: readonly string[],
): boolean {
  if (typeof value === "string") {
    const isAllowedPublicEmail = options.publicEmail !== undefined
      && value === options.publicEmail
      && path.length === 2
      && path[0] === "user"
      && path[1] === "email";
    const activeSecrets = isAllowedPublicEmail
      ? forbidden.filter((secret) => secret !== options.publicEmail)
      : forbidden;
    const scanOptions: CredentialScanOptions = options.allowCsrfTokenKey === true
      ? { allowCsrfTokenKey: true }
      : {};
    return containsCredentialMaterial(value, activeSecrets, scanOptions);
  }
  if (Array.isArray(value)) {
    return value.some((entry, index) => scanJsonValue(entry, forbidden, options, [...path, String(index)]));
  }
  if (!isRecord(value)) return false;
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key, path, options)) return true;
    if (scanJsonValue(entry, forbidden, options, [...path, key])) return true;
  }
  return false;
}

/**
 * Detects credential-bearing JSON keys before exact contract validation.
 * @param key - Current decoded object key.
 * @param path - Parent path used to constrain the sole CSRF-key allowance.
 * @param options - Endpoint-specific CSRF-key allowance.
 * @returns True for password, token, CSRF, or selector-bearing keys.
 */
function isSensitiveKey(
  key: string,
  path: readonly string[],
  options: CredentialScanOptions,
): boolean {
  const normalized = key.replaceAll(/[^A-Za-z]/gu, "").toLowerCase();
  if (
    options.allowCsrfTokenKey === true
    && path.length === 0
    && normalized === "csrftoken"
  ) {
    return false;
  }
  return [
    "accesstoken",
    "refreshtoken",
    "password",
    "csrftoken",
    "sessionselector",
    "selector",
  ].includes(normalized);
}

/**
 * Checks exact object keys internally so assertion failures never print the object.
 * @param value - Candidate parsed JSON value.
 * @param keys - Fixed public keys allowed by the endpoint contract.
 * @returns True when value is a plain JSON object with exactly those own keys.
 */
function hasExactKeys<const Key extends string>(
  value: unknown,
  keys: readonly Key[],
): value is Record<Key, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Narrows parsed JSON objects while excluding arrays and null.
 * @param value - Candidate parsed JSON value.
 * @returns True for a JSON object safe for fixed-key inspection.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Accepts only canonical UTC ISO timestamps so malformed expiry strings stay boolean-safe.
 * @param value - Candidate public expiry value.
 * @returns True when parsing is finite and round-trips to the same ISO string.
 */
function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
