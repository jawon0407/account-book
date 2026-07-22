import "server-only";

import { createHash } from "node:crypto";
import { createDatabaseClient } from "@account-book/database";
import { EmailAuthService } from "./auth/email-auth-service.js";
import { FakeAuthProvider } from "./auth/fake-auth-provider.js";
import { OAuthService } from "./auth/oauth-service.js";
import { PasswordRecoveryService } from "./auth/password-recovery-service.js";
import { SupabaseAuthAdapter } from "./auth/supabase-auth-adapter.js";
import { AuthController } from "./http/auth-controller.js";
import { PostgresAuthRepository } from "./persistence/postgres-auth-repository.js";
import { SessionService } from "./session/session-service.js";
import type { TokenKeyring } from "./security/token-envelope.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
let sharedDatabase: ReturnType<typeof createDatabaseClient> | undefined;
let sharedDatabaseFingerprint: string | undefined;

/** The only authentication adapter modes permitted by the server container. */
export type AuthAdapterMode = "supabase" | "fake";

/** Canonical application origin and validated adapter choice. */
export type AuthRuntime = Readonly<{ mode: AuthAdapterMode; origin: URL }>;

function invalidConfiguration(): never {
  throw new Error("AUTH_CONFIGURATION_INVALID");
}

function canonicalOrigin(value: unknown, production: boolean): URL {
  if (typeof value !== "string" || value.trim() !== value) return invalidConfiguration();
  let origin: URL;
  try { origin = new URL(value); } catch { return invalidConfiguration(); }
  const loopback = LOOPBACK_HOSTS.has(origin.hostname);
  if (
    origin.username !== "" || origin.password !== "" || origin.pathname !== "/" || origin.search !== "" || origin.hash !== "" ||
    !(origin.protocol === "https:" || (!production && loopback && origin.protocol === "http:")) || origin.origin !== value
  ) return invalidConfiguration();
  return origin;
}

/**
 * Resolves the adapter without allowing fake authentication on production or public hosts.
 * @param environment - Server-only environment values; only mode, node environment, and canonical origin are inspected.
 * @returns The strict adapter mode and cloned canonical origin.
 * @throws `AUTH_CONFIGURATION_INVALID` for a missing/unsafe origin or disallowed adapter mode.
 */
export function resolveAuthRuntime(environment: Readonly<Record<string, string | undefined>>): AuthRuntime {
  const production = environment.NODE_ENV === "production";
  const origin = canonicalOrigin(environment.APP_ORIGIN, production);
  const modeValue = environment.AUTH_ADAPTER_MODE ?? "supabase";
  if (modeValue !== "supabase" && modeValue !== "fake") return invalidConfiguration();
  if (modeValue === "fake" && (production || !LOOPBACK_HOSTS.has(origin.hostname))) return invalidConfiguration();
  return { mode: modeValue, origin };
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return invalidConfiguration();
  return value;
}

function serverUrl(value: string, protocols: ReadonlySet<string>, rootOnly: boolean): URL {
  let url: URL;
  try { url = new URL(value); } catch { return invalidConfiguration(); }
  if (!protocols.has(url.protocol) || url.hash !== "" || (rootOnly && (url.pathname !== "/" || url.search !== ""))) return invalidConfiguration();
  if (protocols.has("http:") && (url.username !== "" || url.password !== "")) return invalidConfiguration();
  return url;
}

function fakeProviderUrl(value: string): URL {
  const url = serverUrl(value, new Set(["http:"]), false);
  if (url.toString() !== value || url.hostname !== "127.0.0.1" || url.port !== "4510" || url.pathname !== "/token" || url.search !== "") return invalidConfiguration();
  return url;
}

function canonicalKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return invalidConfiguration();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) return invalidConfiguration();
  return decoded;
}

function keyring(environment: Readonly<Record<string, string | undefined>>): TokenKeyring {
  const currentKeyId = required(environment, "AUTH_TOKEN_KEY_ID");
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(currentKeyId)) return invalidConfiguration();
  const keys = new Map<string, Uint8Array>([[currentKeyId, canonicalKey(required(environment, "AUTH_TOKEN_KEY"))]]);
  const previous = environment.AUTH_TOKEN_PREVIOUS_KEYS;
  if (previous !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(previous); } catch { return invalidConfiguration(); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return invalidConfiguration();
    for (const [keyId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9._-]{1,128}$/u.test(keyId) || keyId === currentKeyId || typeof value !== "string") return invalidConfiguration();
      keys.set(keyId, canonicalKey(value));
    }
  }
  return { currentKeyId, keys };
}

function databaseClient(connectionString: string): ReturnType<typeof createDatabaseClient> {
  const fingerprint = createHash("sha256").update(connectionString).digest("base64url");
  if (sharedDatabase === undefined) {
    sharedDatabase = createDatabaseClient(connectionString);
    sharedDatabaseFingerprint = fingerprint;
  } else if (sharedDatabaseFingerprint !== fingerprint) {
    return invalidConfiguration();
  }
  return sharedDatabase;
}

/** The request-owned dependency graph exposed to the route adapter. */
export type RequestContainer = Readonly<{ authController: AuthController }>;

/**
 * Reuses one process-scoped infrastructure database client while constructing fresh request-scoped repository, provider, session, use-case, and HTTP objects.
 * @param environment - Complete server-only runtime environment; secrets are parsed but never retained in errors.
 * @returns A request-owned controller graph with no user session cached at module scope.
 * @throws `AUTH_CONFIGURATION_INVALID` before constructing an adapter when any required value is unsafe.
 */
export function createRequestContainer(environment: Readonly<Record<string, string | undefined>> = process.env): RequestContainer {
  try {
    const runtime = resolveAuthRuntime(environment);
    const databaseUrl = serverUrl(required(environment, "DATABASE_URL"), new Set(["postgres:", "postgresql:"]), false).toString();
    const apiInternalUrl = serverUrl(required(environment, "API_INTERNAL_URL"), new Set(["http:", "https:"]), true);
    const tokenKeyring = keyring(environment);
    const csrfKey = canonicalKey(required(environment, "AUTH_CSRF_HMAC_KEY"));
    const repository = new PostgresAuthRepository(databaseClient(databaseUrl));
    const provider = runtime.mode === "fake"
      ? new FakeAuthProvider(environment.AUTH_FAKE_PROVIDER_URL === undefined ? undefined : { tokenUrl: fakeProviderUrl(required(environment, "AUTH_FAKE_PROVIDER_URL")) })
      : new SupabaseAuthAdapter({
          url: serverUrl(required(environment, "SUPABASE_URL"), new Set(["http:", "https:"]), true).toString(),
          anonKey: required(environment, "SUPABASE_ANON_KEY"),
        });
    const sessions = new SessionService(repository, tokenKeyring, async (refreshToken) => provider.refresh(refreshToken));
    const email = new EmailAuthService(provider, sessions, repository, tokenKeyring);
    const oauth = new OAuthService(repository, provider, sessions, tokenKeyring);
    const recovery = new PasswordRecoveryService(repository, provider, tokenKeyring);
    return {
      authController: new AuthController({
        configuredOrigin: runtime.origin,
        apiInternalUrl,
        secureCookies: true,
        csrfKey,
        now: () => new Date(),
        email,
        oauth,
        recovery,
        sessions,
        provider,
      }),
    };
  } catch {
    return invalidConfiguration();
  }
}
