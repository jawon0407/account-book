import { z } from "zod";

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

const isSafeValue = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !hasControlCharacter(value);

const EXACT_LOOPBACK_HTTP = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:[/?#]|$)/iu;

const isSafeHttpUrl = (value: string): boolean => {
  if (!isSafeValue(value)) return false;
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "" || url.hash !== "") return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:"
      && EXACT_LOOPBACK_HTTP.test(value)
      && new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname);
  } catch {
    return false;
  }
};

const SafeValueSchema = z.string().refine(isSafeValue);
const SafeHttpUrlSchema = z.string().refine(isSafeHttpUrl);
const ApiPortSchema = z.string().regex(/^[1-9][0-9]{0,4}$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535))
  .default(3001);

const ApiEnvironmentSchema = z.object({
  API_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  API_PORT: ApiPortSchema,
  AUTH_JWKS_URL: SafeHttpUrlSchema,
  AUTH_JWT_ISSUER: SafeHttpUrlSchema,
  AUTH_JWT_AUDIENCE: SafeValueSchema,
  AUTH_JWT_ALGORITHM: z.enum(["ES256", "RS256"]),
});

/** Immutable server-only settings accepted by the API trust boundary. */
export type ApiEnvironment = Readonly<{
  apiHost: "127.0.0.1" | "0.0.0.0";
  apiPort: number;
  authJwksUrl: string;
  authJwtIssuer: string;
  authJwtAudience: string;
  authJwtAlgorithm: "ES256" | "RS256";
}>;

/**
 * Parses server environment input into an immutable API configuration.
 * @param input - Untrusted process environment values.
 * @returns Frozen listener and JWT settings after value checks, URL checks, and protocol checks.
 * @throws A fixed configuration error; unsafe URLs and values fail closed without being echoed.
 */
export function parseApiEnvironment(input: Readonly<Record<string, string | undefined>>): ApiEnvironment {
  const parsed = ApiEnvironmentSchema.safeParse(input);
  if (!parsed.success) throw new Error("API_CONFIGURATION_INVALID");
  return Object.freeze({
    apiHost: parsed.data.API_HOST,
    apiPort: parsed.data.API_PORT,
    authJwksUrl: parsed.data.AUTH_JWKS_URL,
    authJwtIssuer: parsed.data.AUTH_JWT_ISSUER,
    authJwtAudience: parsed.data.AUTH_JWT_AUDIENCE,
    authJwtAlgorithm: parsed.data.AUTH_JWT_ALGORITHM,
  });
}

let cachedEnvironment: ApiEnvironment | undefined;

/**
 * Returns the one process-wide API environment snapshot.
 * @returns A frozen configuration parsed once from `process.env` before reuse.
 * @throws A fixed configuration error before any unsafe or incomplete setting can be consumed.
 */
export function getApiEnvironment(): ApiEnvironment {
  cachedEnvironment ??= parseApiEnvironment(process.env);
  return cachedEnvironment;
}
