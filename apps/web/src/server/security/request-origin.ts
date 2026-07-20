import { AuthRequestRejectedError, verifyCsrfToken } from "./csrf.js";

const FETCH_MODES = new Set(["cors", "no-cors", "same-origin"]);

/** A framework-neutral request shape compatible with standard Request and Headers objects. */
export type AuthRequest = Readonly<{
  method: string;
  headers: Readonly<{ get(name: string): string | null }>;
}>;

/** Server-only inputs required to validate a state-changing browser request. */
export type CsrfRequestPolicy = Readonly<{
  now: Date;
  key: Uint8Array;
  allowedOrigins: ReadonlySet<string>;
}>;

export { AuthRequestRejectedError };

function rejected(): never {
  throw new AuthRequestRejectedError();
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function exactOrigin(value: unknown): string {
  if (typeof value !== "string" || hasControlCharacter(value) || value.trim() !== value) return rejected();
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.origin !== value) return rejected();
    return value;
  } catch {
    return rejected();
  }
}

function allowedOrigins(policy: unknown): ReadonlySet<string> {
  if (policy === null || typeof policy !== "object") return rejected();
  const values = (policy as { allowedOrigins?: unknown }).allowedOrigins;
  if (!(values instanceof Set) || values.size === 0) return rejected();
  for (const origin of values) exactOrigin(origin);
  return values as ReadonlySet<string>;
}

function header(request: unknown, name: string): string | null {
  if (request === null || typeof request !== "object") return rejected();
  const headers = (request as { headers?: unknown }).headers;
  if (headers === null || typeof headers !== "object" || typeof (headers as { get?: unknown }).get !== "function") return rejected();
  const value = (headers as { get(name: string): unknown }).get(name);
  if (value !== null && (typeof value !== "string" || hasControlCharacter(value))) return rejected();
  return value;
}

function jsonContentType(value: string | null): boolean {
  if (value === null || value.includes(",")) return false;
  const [mediaType, ...parameters] = value.split(";");
  return mediaType?.trim().toLowerCase() === "application/json" && parameters.every((parameter) => /^\s*[^=\s]+\s*=\s*.+\s*$/u.test(parameter));
}

function allowedOrigin(value: string, origins: ReadonlySet<string>): boolean {
  return origins.has(exactOrigin(value));
}

function refererAllowed(value: string | null, origins: ReadonlySet<string>): boolean {
  if (value === null || hasControlCharacter(value) || value.trim() !== value) return false;
  try {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password && origins.has(parsed.origin);
  } catch {
    return false;
  }
}

/** Rejects a non-POST, cross-origin, non-JSON, or CSRF-invalid browser request before mutation. */
export function verifyCsrfRequest(request: AuthRequest, context: Readonly<{ selector: string }>, policy: CsrfRequestPolicy): void {
  try {
    const origins = allowedOrigins(policy);
    const contentType = header(request, "Content-Type");
    if ((request as { method?: unknown }).method !== "POST" || !jsonContentType(contentType)) return rejected();
    const origin = header(request, "Origin");
    if (origin === null ? !refererAllowed(header(request, "Referer"), origins) : !allowedOrigin(origin, origins)) return rejected();
    const site = header(request, "Sec-Fetch-Site");
    if (site !== "same-origin" && site !== "none") return rejected();
    const mode = header(request, "Sec-Fetch-Mode");
    if (mode !== null && !FETCH_MODES.has(mode)) return rejected();
    const destination = header(request, "Sec-Fetch-Dest");
    if (destination !== null && destination !== "") return rejected();
    const token = header(request, "X-CSRF-Token");
    if (token === null || token.includes(",")) return rejected();
    verifyCsrfToken(token, context, policy.now, policy.key);
  } catch {
    return rejected();
  }
}
