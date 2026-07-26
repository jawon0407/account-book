import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { z } from "zod";

const SAFE_KEY_ID = /^[A-Za-z0-9._-]{1,128}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const ApiPortSchema = z.string().regex(/^[1-9][0-9]{0,4}$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535))
  .default(3001);

/** Immutable static public-key view used only for delegated API JWT verification. */
export type DelegatedJwtKeyring = Readonly<Record<string, KeyObject>>;

/** Immutable server-only settings accepted by the API delegated-JWT trust boundary. */
export type ApiEnvironment = Readonly<{
  apiHost: "127.0.0.1" | "0.0.0.0";
  apiPort: number;
  apiDatabaseUrl: string;
  bffAuthDisabled: boolean;
  bffJwtAcceptedKids: readonly string[];
  bffJwtPublicKeys: DelegatedJwtKeyring;
}> & Readonly<{
  /** @deprecated Task 6 removes this compile-only bridge; it is never parsed or present at runtime. */
  authJwksUrl: never;
  /** @deprecated Task 6 removes this compile-only bridge; it is never parsed or present at runtime. */
  authJwtIssuer: never;
  /** @deprecated Task 6 removes this compile-only bridge; it is never parsed or present at runtime. */
  authJwtAudience: never;
  /** @deprecated Task 6 removes this compile-only bridge; it is never parsed or present at runtime. */
  authJwtAlgorithm: never;
}>;

/** Rejects environment strings that can hide configuration or cause parser ambiguity. */
function safeEnvironmentValue(value: string | undefined): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value
    && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
}

/** Parses the bounded listener configuration without coercing unsafe input. */
function parseListener(input: Readonly<Record<string, string | undefined>>): Pick<ApiEnvironment, "apiHost" | "apiPort"> {
  const apiHost = input.API_HOST ?? "127.0.0.1";
  const parsedPort = ApiPortSchema.safeParse(input.API_PORT);
  if ((apiHost !== "127.0.0.1" && apiHost !== "0.0.0.0") || !parsedPort.success) throw new Error("API_CONFIGURATION_INVALID");
  return { apiHost, apiPort: parsedPort.data };
}

/** Validates the API-owned database connection without disclosing credentials on failure. */
function parseDatabaseUrl(value: string | undefined): string {
  if (!safeEnvironmentValue(value) || /[\u0000-\u0020\u007f]/u.test(value)) throw new Error("API_CONFIGURATION_INVALID");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || url.username !== "app_api"
    || url.password === ""
    || url.hash !== ""
    || url.hostname === ""
  ) throw new Error("API_CONFIGURATION_INVALID");
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  const sslmodes = url.searchParams.getAll("sslmode");
  if (sslmodes.length > 1) throw new Error("API_CONFIGURATION_INVALID");
  const sslmode = sslmodes[0];
  const allowedModes = loopback ? ["disable", "require", "verify-ca", "verify-full"] : ["require", "verify-ca", "verify-full"];
  if ((sslmode !== undefined && !allowedModes.includes(sslmode)) || (!loopback && sslmode === undefined)) throw new Error("API_CONFIGURATION_INVALID");
  return value;
}

/** Parses a JSON accepted-kid list and rejects duplicate or unsafe identifiers. */
function parseAcceptedKids(value: string | undefined): readonly string[] {
  if (!safeEnvironmentValue(value)) throw new Error("API_CONFIGURATION_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 3 || !parsed.every((kid) => typeof kid === "string" && SAFE_KEY_ID.test(kid))) {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  if (new Set(parsed).size !== parsed.length) throw new Error("API_CONFIGURATION_INVALID");
  return Object.freeze([...parsed]);
}

/** Parses a deliberately narrow flat JSON object so duplicate key members cannot be overwritten by JSON.parse. */
function parseFlatKeyObject(value: string | undefined): readonly (readonly [string, string])[] {
  if (!safeEnvironmentValue(value)) throw new Error("API_CONFIGURATION_INVALID");
  const match = /^\{\s*(?:"([A-Za-z0-9._-]{1,128})"\s*:\s*"([A-Za-z0-9_-]+)"\s*)(?:,\s*"([A-Za-z0-9._-]{1,128})"\s*:\s*"([A-Za-z0-9_-]+)"\s*){0,2}\}$/u.exec(value);
  if (!match) throw new Error("API_CONFIGURATION_INVALID");
  const entries: [string, string][] = [[match[1]!, match[2]!]];
  const remainder = value.slice(value.indexOf(",") + 1);
  if (value.includes(",")) {
    const entriesPattern = /"([A-Za-z0-9._-]{1,128})"\s*:\s*"([A-Za-z0-9_-]+)"/gu;
    for (const entry of remainder.matchAll(entriesPattern)) entries.push([entry[1]!, entry[2]!]);
  }
  if (entries.length === 0 || entries.length > 3 || new Set(entries.map(([kid]) => kid)).size !== entries.length) throw new Error("API_CONFIGURATION_INVALID");
  return entries;
}

/** Imports one canonical P-256 SPKI key, rejecting private, malformed, or trailing-DER encodings. */
function parsePublicKey(value: string): KeyObject {
  if (!BASE64URL.test(value)) throw new Error("API_CONFIGURATION_INVALID");
  const der = Buffer.from(value, "base64url");
  if (der.length === 0 || der.toString("base64url") !== value) throw new Error("API_CONFIGURATION_INVALID");
  try {
    createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    throw new Error("API_CONFIGURATION_INVALID");
  } catch (error) {
    if (error instanceof Error && error.message === "API_CONFIGURATION_INVALID") throw error;
  }
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  const canonical = key.export({ format: "der", type: "spki" });
  if (!Buffer.from(canonical).equals(der) || key.type !== "public" || key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  return key;
}

/** Parses an immutable static keyring and checks that every accepted kid is locally owned. */
function parseKeyring(value: string | undefined, acceptedKids: readonly string[]): DelegatedJwtKeyring {
  const entries = parseFlatKeyObject(value);
  const keyring: Record<string, KeyObject> = {};
  for (const [kid, encoded] of entries) keyring[kid] = parsePublicKey(encoded);
  if (!acceptedKids.every((kid) => Object.hasOwn(keyring, kid))) throw new Error("API_CONFIGURATION_INVALID");
  return Object.freeze(keyring);
}

/**
 * Parses server environment input into an immutable static delegated-JWT configuration.
 * @param input - Untrusted process environment values.
 * @returns Frozen listener, database, kill-switch, accepted-key, and P-256 keyring settings.
 * @throws A fixed configuration error without echoing unsafe input or credentials.
 */
export function parseApiEnvironment(input: Readonly<Record<string, string | undefined>>): ApiEnvironment {
  try {
    const listener = parseListener(input);
    if (input.BFF_AUTH_DISABLED !== "true" && input.BFF_AUTH_DISABLED !== "false") throw new Error("API_CONFIGURATION_INVALID");
    const acceptedKids = parseAcceptedKids(input.BFF_JWT_ACCEPTED_KIDS);
    return Object.freeze({
      ...listener,
      apiDatabaseUrl: parseDatabaseUrl(input.API_DATABASE_URL),
      bffAuthDisabled: input.BFF_AUTH_DISABLED === "true",
      bffJwtAcceptedKids: acceptedKids,
      bffJwtPublicKeys: parseKeyring(input.BFF_JWT_PUBLIC_KEYS, acceptedKids),
    }) as ApiEnvironment;
  } catch {
    throw new Error("API_CONFIGURATION_INVALID");
  }
}

let cachedEnvironment: ApiEnvironment | undefined;

/**
 * Returns the one process-wide immutable API environment snapshot.
 * @returns A frozen static configuration parsed once from `process.env`.
 * @throws A fixed configuration error before any unsafe configuration can be consumed.
 */
export function getApiEnvironment(): ApiEnvironment {
  cachedEnvironment ??= parseApiEnvironment(process.env);
  return cachedEnvironment;
}
