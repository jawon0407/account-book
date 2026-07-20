import { randomUUID } from "node:crypto";
import { AuthProviderSchema, CurrentUserSchema, type AuthProvider, type CurrentUser } from "@account-book/contracts";
import type { AuthRepository, OAuthTransactionRecord } from "../persistence/auth-repository.js";
import { createPkceVerifier, derivePkceChallenge } from "../security/pkce.js";
import { createSessionSelector, hashSessionSelector } from "../security/session-selector.js";
import { decryptToken, encryptToken, type TokenKeyring } from "../security/token-envelope.js";
import type { SessionTokenPair } from "../session/session-service.js";
import { AuthProviderError, type AuthProviderErrorCode, type AuthProviderPort, type AuthTokenPair } from "./auth-provider-port.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const OAUTH_LIFETIME_MS = 10 * 60_000;
const RETURN_PATHS = new Set(["/app", "/settings/security"]);

/** Trusted request context required to begin one interaction-bound OAuth transaction. */
export type OAuthStartContext = Readonly<{
  callbackBaseUrl: URL;
  interactionSelector: string;
  returnPath: "/app" | "/settings/security";
  now: Date;
}>;
/** Browser callback values accepted only after exact transaction matching. */
export type OAuthCallback = Readonly<{ provider: AuthProvider; state: string; code: string }>;
/** Existing pre-auth browser interaction and trusted time for callback completion. */
export type OAuthCompleteContext = Readonly<{ interactionSelector: string; now: Date }>;
type SessionCreator = Readonly<{ create(tokens: SessionTokenPair, now: Date): Promise<Readonly<{ selector: string; accessTokenExpiresAt: Date; absoluteExpiresAt: Date }>> }>;
type PublicResult = Readonly<{ selector: string; user: CurrentUser; accessTokenExpiresAt: Date; absoluteExpiresAt: Date; returnPath: "/app" | "/settings/security" }>;

/** Fixed OAuth use-case error that never includes callback or provider values. */
export class OAuthServiceError extends Error {
  /** Creates one allowlisted OAuth failure without retaining submitted values. */
  public constructor(public readonly code: AuthProviderErrorCode = "AUTH_OAUTH_TRANSACTION_INVALID") {
    super(code);
    this.name = "OAuthServiceError";
  }
}

function fail(code: AuthProviderErrorCode = "AUTH_OAUTH_TRANSACTION_INVALID"): never { throw new OAuthServiceError(code); }
function validDate(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }
function postProviderTime(clock: () => Date): Date { const value = clock(); if (!validDate(value)) return fail("AUTH_PROVIDER_UNAVAILABLE"); return new Date(value); }
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
function validReturnPath(value: unknown): "/app" | "/settings/security" { if (typeof value !== "string" || !RETURN_PATHS.has(value)) return fail(); return value as "/app" | "/settings/security"; }
function validCode(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail();
  return value;
}
function validCallbackBase(value: unknown): URL {
  if (!(value instanceof URL)) return fail();
  const url = new URL(value.toString());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || url.hash !== "" || !(url.protocol === "https:" || (local && url.protocol === "http:")) || url.searchParams.has("provider") || url.searchParams.has("state")) return fail();
  return url;
}
function validAuthorizeUrl(value: unknown): URL {
  if (!(value instanceof URL)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  const url = new URL(value.toString());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" || (local && url.protocol === "http:")) || url.username !== "" || url.password !== "" || url.hash !== "") return fail("AUTH_PROVIDER_UNAVAILABLE");
  return url;
}
function shifted(date: Date, milliseconds: number): Date {
  const result = new Date(date.getTime() + milliseconds);
  if (!validDate(result)) return fail();
  return result;
}
function selectorHash(value: unknown): Uint8Array {
  try { return hashSessionSelector(value as string); } catch { return fail(); }
}
function sameDigest(left: Uint8Array, right: Uint8Array): boolean { return left.length === 32 && right.length === 32 && Buffer.from(left).equals(Buffer.from(right)); }
function trustedPair(value: AuthTokenPair, now: Date): AuthTokenPair {
  const user = CurrentUserSchema.safeParse(value?.user);
  if (
    !user.success || !user.data.emailVerified || user.data.id !== value?.userId || !validUuid(value?.userId) || !validUuid(value?.supabaseSessionId) ||
    typeof value?.accessToken !== "string" || value.accessToken.length === 0 || typeof value?.refreshToken !== "string" || value.refreshToken.length === 0 ||
    !Number.isSafeInteger(value?.issuedAtSeconds) || value.issuedAtSeconds <= 0 || value.issuedAtSeconds > Math.floor(now.getTime() / 1000) ||
    !validDate(value?.accessTokenExpiresAt) || value.accessTokenExpiresAt.getTime() <= now.getTime() || value.accessTokenExpiresAt.getTime() <= value.issuedAtSeconds * 1000
  ) return fail("AUTH_PROVIDER_UNAVAILABLE");
  return value;
}
function trustedClaim(record: OAuthTransactionRecord, input: { provider: AuthProvider; stateHash: Uint8Array; interactionHash: Uint8Array; now: Date }): OAuthTransactionRecord {
  if (
    !validUuid(record?.id) || record?.provider !== input.provider || !sameDigest(record?.stateHash, input.stateHash) || !sameDigest(record?.interactionHash, input.interactionHash) ||
    !validDate(record?.createdAt) || !validDate(record?.expiresAt) || !validDate(record?.consumedAt) || record.expiresAt.getTime() <= input.now.getTime() ||
    record.expiresAt.getTime() - record.createdAt.getTime() !== OAUTH_LIFETIME_MS || !validReturnPath(record?.returnPath)
  ) return fail();
  return record;
}
function providerFailure(error: unknown): never {
  if (error instanceof OAuthServiceError) throw error;
  if (error instanceof AuthProviderError) return fail(error.code);
  return fail("AUTH_PROVIDER_UNAVAILABLE");
}

/** Owns OAuth state, PKCE persistence, atomic callback claim, and opaque-session creation. */
export class OAuthService {
  /** Installs narrow persistence/provider/session ports and injectable cryptographic generators for deterministic tests. */
  public constructor(
    private readonly repository: Pick<AuthRepository, "createOAuthTransaction" | "claimOAuthTransaction">,
    private readonly provider: Pick<AuthProviderPort, "startOAuth" | "exchangeOAuthCode">,
    private readonly sessions: SessionCreator,
    private readonly keyring: TokenKeyring,
    private readonly createId: () => string = randomUUID,
    private readonly createState: () => string = createSessionSelector,
    private readonly createVerifier: () => string = createPkceVerifier,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Persists a ten-minute encrypted verifier before provider authorization.
   * @param providerValue - One approved provider identifier.
   * @param context - Trusted callback, interaction, return path, and time.
   * @returns Only the validated provider authorization URL.
   * @throws A fixed OAuth/provider code when validation, persistence, or the provider fails.
   */
  public async start(providerValue: unknown, context: OAuthStartContext): Promise<Readonly<{ authorizationUrl: URL }>> {
    try {
      const provider = AuthProviderSchema.safeParse(providerValue);
      if (!provider.success || !validDate(context?.now)) return fail();
      const callback = validCallbackBase(context?.callbackBaseUrl);
      const returnPath = validReturnPath(context?.returnPath);
      const interactionHash = selectorHash(context?.interactionSelector);
      const state = this.createState();
      const stateHash = selectorHash(state);
      const verifier = this.createVerifier();
      const codeChallenge = derivePkceChallenge(verifier);
      const id = this.createId();
      if (!validUuid(id)) return fail();
      callback.searchParams.set("provider", provider.data);
      callback.searchParams.set("state", state);
      await this.repository.createOAuthTransaction({
        id,
        stateHash,
        interactionHash,
        provider: provider.data,
        encryptedPkceVerifier: encryptToken(verifier, { recordId: id, tokenKind: "pkce" }, this.keyring),
        returnPath,
        createdAt: new Date(context.now),
        expiresAt: shifted(context.now, OAUTH_LIFETIME_MS),
        consumedAt: null,
      });
      const result = await this.provider.startOAuth({ provider: provider.data, redirectUrl: callback, codeChallenge });
      return { authorizationUrl: validAuthorizeUrl(result?.authorizationUrl) };
    } catch (error) { return providerFailure(error); }
  }

  /**
   * Claims the exact live callback before exchanging its code.
   * @param callback - Provider, state, and authorization code from the callback.
   * @param context - Existing browser interaction and trusted time.
   * @returns Opaque session metadata and the stored allowlisted return path.
   * @throws A fixed OAuth/provider code for invalid, replayed, expired, or failed callbacks.
   */
  public async complete(callback: OAuthCallback, context: OAuthCompleteContext): Promise<PublicResult> {
    try {
      const provider = AuthProviderSchema.safeParse(callback?.provider);
      if (!provider.success || !validDate(context?.now)) return fail();
      const code = validCode(callback?.code);
      const stateHash = selectorHash(callback?.state);
      const interactionHash = selectorHash(context?.interactionSelector);
      const input = { provider: provider.data, stateHash, interactionHash, now: new Date(context.now) };
      const claimed = await this.repository.claimOAuthTransaction(input);
      if (claimed === null) return fail();
      const record = trustedClaim(claimed, input);
      const codeVerifier = decryptToken(record.encryptedPkceVerifier, { recordId: record.id, tokenKind: "pkce" }, this.keyring);
      derivePkceChallenge(codeVerifier);
      const providerPair = await this.provider.exchangeOAuthCode({ code, codeVerifier });
      const completedAt = postProviderTime(this.clock);
      const pair = trustedPair(providerPair, completedAt);
      const created = await this.sessions.create({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, userId: pair.userId, supabaseSessionId: pair.supabaseSessionId, issuedAtSeconds: pair.issuedAtSeconds, accessTokenExpiresAt: pair.accessTokenExpiresAt }, completedAt);
      return { selector: created.selector, user: pair.user, accessTokenExpiresAt: created.accessTokenExpiresAt, absoluteExpiresAt: created.absoluteExpiresAt, returnPath: record.returnPath };
    } catch (error) {
      if (error instanceof OAuthServiceError || error instanceof AuthProviderError) return providerFailure(error);
      return fail();
    }
  }
}
