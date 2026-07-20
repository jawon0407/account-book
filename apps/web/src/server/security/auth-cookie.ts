const SELECTOR_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** The only cookie names this authentication boundary may create or remove. */
export const SESSION_COOKIE_NAME = "__Host-ab_session";
/** The only cookie names this authentication boundary may create or remove. */
export const INTERACTION_COOKIE_NAME = "__Host-ab_interaction";

/** A host-only opaque authentication cookie suitable for response serialization. */
export type AuthCookie = Readonly<{
  name: typeof SESSION_COOKIE_NAME | typeof INTERACTION_COOKIE_NAME;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  priority: "high";
}>;

function invalidCookie(): never {
  throw new Error("AUTH_COOKIE_INVALID");
}

function selector(value: unknown): string {
  if (typeof value !== "string" || !SELECTOR_PATTERN.test(value)) {
    return invalidCookie();
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    return invalidCookie();
  }
  return value;
}

function cookie(name: AuthCookie["name"], value: string, secure: unknown): AuthCookie {
  if (typeof secure !== "boolean") return invalidCookie();
  return { name, value: selector(value), httpOnly: true, secure, sameSite: "lax", path: "/", priority: "high" };
}

/** Creates the host-only HttpOnly cookie for a validated opaque session selector. */
export function sessionCookie(value: string, secure: boolean): AuthCookie {
  return cookie(SESSION_COOKIE_NAME, value, secure);
}

/** Creates the host-only HttpOnly cookie for a validated pre-auth interaction selector. */
export function interactionCookie(value: string, secure: boolean): AuthCookie {
  return cookie(INTERACTION_COOKIE_NAME, value, secure);
}

/** Removes only a known authentication cookie while preserving its host-only scope. */
export function clearAuthCookie(name: AuthCookie["name"], secure: boolean): AuthCookie & Readonly<{ maxAge: 0 }> {
  if ((name !== SESSION_COOKIE_NAME && name !== INTERACTION_COOKIE_NAME) || typeof secure !== "boolean") return invalidCookie();
  return { name, value: "", httpOnly: true, secure, sameSite: "lax", path: "/", priority: "high", maxAge: 0 };
}
