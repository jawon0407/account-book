import { randomUUID } from "node:crypto";
import { CurrentUserSchema, SignInInputSchema, SignUpInputSchema, type CurrentUser } from "@account-book/contracts";
import type { AuthRepository, EmailConfirmationTransactionRecord } from "../persistence/auth-repository.js";
import { createPkceVerifier, derivePkceChallenge } from "../security/pkce.js";
import { hashSessionSelector } from "../security/session-selector.js";
import { decryptToken, encryptToken, type TokenKeyring } from "../security/token-envelope.js";
import type { SessionTokenPair } from "../session/session-service.js";
import { AuthProviderError, type AuthProviderErrorCode, type AuthProviderPort, type AuthTokenPair } from "./auth-provider-port.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CONFIRMATION_LIFETIME_MS = 15 * 60_000;

/** Trusted callbacks, pre-auth interaction, and time for an email-auth operation. */
export type EmailAuthContext = Readonly<{ emailRedirectUrl: URL; interactionSelector: string; now: Date }>;
type SessionCreator = Readonly<{ create(tokens: SessionTokenPair, now: Date): Promise<Readonly<{ selector: string; accessTokenExpiresAt: Date; absoluteExpiresAt: Date }>> }>;
type PublicSession = Readonly<{ selector: string; user: CurrentUser; accessTokenExpiresAt: Date; absoluteExpiresAt: Date }>;

/** Fixed use-case error that never includes credentials, codes, emails, verifiers, or selectors. */
export class EmailAuthServiceError extends Error {
  /** Creates one allowlisted email-auth failure without retaining submitted values. */
  public constructor(public readonly code: AuthProviderErrorCode) {
    super(code);
    this.name = "EmailAuthServiceError";
  }
}

function fail(code: AuthProviderErrorCode = "AUTH_PROVIDER_UNAVAILABLE"): never { throw new EmailAuthServiceError(code); }
function validDate(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
function safeCode(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
  return value;
}
function safeUrl(value: unknown): URL {
  if (!(value instanceof URL)) return fail();
  const url = new URL(value.toString());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || url.hash !== "" || !(url.protocol === "https:" || (local && url.protocol === "http:"))) return fail();
  return url;
}
function safeContext(context: EmailAuthContext): Readonly<EmailAuthContext & { interactionHash: Uint8Array }> {
  if (!validDate(context?.now)) return fail();
  let interactionHash: Uint8Array;
  try { interactionHash = hashSessionSelector(context?.interactionSelector); } catch { return fail("AUTH_OAUTH_TRANSACTION_INVALID"); }
  return { emailRedirectUrl: safeUrl(context?.emailRedirectUrl), interactionSelector: context.interactionSelector, interactionHash, now: context.now };
}
function providerFailure(error: unknown): never {
  if (error instanceof EmailAuthServiceError) throw error;
  if (error instanceof AuthProviderError) return fail(error.code);
  return fail();
}
function verifiedPair(pair: AuthTokenPair, now: Date): AuthTokenPair {
  const parsed = CurrentUserSchema.safeParse(pair?.user);
  if (!parsed.success || !parsed.data.emailVerified || parsed.data.id !== pair?.userId) return fail("AUTH_EMAIL_VERIFICATION_REQUIRED");
  if (!validUuid(pair?.userId) || !validUuid(pair?.supabaseSessionId) || typeof pair?.accessToken !== "string" || pair.accessToken.length === 0 || typeof pair?.refreshToken !== "string" || pair.refreshToken.length === 0 || !validDate(pair?.accessTokenExpiresAt) || pair.accessTokenExpiresAt.getTime() <= now.getTime()) return fail();
  return pair;
}
function shifted(now: Date): Date {
  const expiresAt = new Date(now.getTime() + CONFIRMATION_LIFETIME_MS);
  if (!validDate(expiresAt)) return fail();
  return expiresAt;
}
function claimed(record: EmailConfirmationTransactionRecord, interactionHash: Uint8Array, now: Date): EmailConfirmationTransactionRecord {
  if (
    !validUuid(record?.id) || !(record?.interactionHash instanceof Uint8Array) || record.interactionHash.length !== 32 || !Buffer.from(record.interactionHash).equals(Buffer.from(interactionHash)) ||
    !validDate(record?.createdAt) || !validDate(record?.expiresAt) || !validDate(record?.consumedAt) || record.expiresAt.getTime() <= now.getTime() ||
    record.expiresAt.getTime() - record.createdAt.getTime() !== CONFIRMATION_LIFETIME_MS
  ) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
  return record;
}

/** Coordinates email signup PKCE continuity, verified sign-in, and opaque-session creation. */
export class EmailAuthService {
  /** Installs narrow provider/session/transaction ports and injectable cryptographic generators. */
  public constructor(
    private readonly provider: Pick<AuthProviderPort, "signUp" | "signInWithPassword" | "confirmEmail">,
    private readonly sessions: SessionCreator,
    private readonly repository: Pick<AuthRepository, "createEmailConfirmationTransaction" | "claimEmailConfirmationTransaction">,
    private readonly keyring: TokenKeyring,
    private readonly createId: () => string = randomUUID,
    private readonly createVerifier: () => string = createPkceVerifier,
  ) {}

  /**
   * Stores a fifteen-minute encrypted verifier before signup delivery.
   * @param input - Untrusted signup credentials validated at this boundary.
   * @param context - Trusted callback, interaction, and time.
   * @returns The account-enumeration-resistant acknowledgement.
   * @throws A fixed auth code for invalid input or unavailable dependencies.
   */
  public async signUp(input: unknown, context: EmailAuthContext): Promise<Readonly<{ accepted: true }>> {
    try {
      const parsed = SignUpInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      const trusted = safeContext(context);
      const id = this.createId();
      if (!validUuid(id)) return fail();
      const verifier = this.createVerifier();
      const challenge = derivePkceChallenge(verifier);
      await this.repository.createEmailConfirmationTransaction({
        id,
        interactionHash: trusted.interactionHash,
        encryptedPkceVerifier: encryptToken(verifier, { recordId: id, tokenKind: "pkce" }, this.keyring),
        createdAt: new Date(trusted.now),
        expiresAt: shifted(trusted.now),
        consumedAt: null,
      });
      await this.provider.signUp(parsed.data, trusted.emailRedirectUrl, challenge);
      return { accepted: true };
    } catch (error) {
      if (error instanceof AuthProviderError && (error.code === "AUTH_INVALID_CREDENTIALS" || error.code === "AUTH_EMAIL_VERIFICATION_REQUIRED")) return { accepted: true };
      return providerFailure(error);
    }
  }

  /**
   * Signs in one verified email user.
   * @param input - Untrusted email/password credentials.
   * @param context - Trusted interaction and time context.
   * @returns Only opaque-session metadata and the public user.
   * @throws A fixed auth code for invalid, unverified, or failed sign-in.
   */
  public async signIn(input: unknown, context: EmailAuthContext): Promise<PublicSession> {
    try {
      const parsed = SignInInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      const trusted = safeContext(context);
      return await this.create(verifiedPair(await this.provider.signInWithPassword(parsed.data), trusted.now), trusted.now);
    } catch (error) { return providerFailure(error); }
  }

  /**
   * Claims the live email transaction before code exchange.
   * @param input - The server callback code.
   * @param context - Trusted interaction and callback time.
   * @returns Only opaque-session metadata and the verified public user.
   * @throws A fixed auth code for malformed, expired, replayed, or failed confirmation.
   */
  public async confirmEmail(input: Readonly<{ code: string }>, context: EmailAuthContext): Promise<PublicSession> {
    try {
      const code = safeCode(input?.code);
      const trusted = safeContext(context);
      const transaction = await this.repository.claimEmailConfirmationTransaction(trusted.interactionHash, new Date(trusted.now));
      if (transaction === null) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
      const record = claimed(transaction, trusted.interactionHash, trusted.now);
      const codeVerifier = decryptToken(record.encryptedPkceVerifier, { recordId: record.id, tokenKind: "pkce" }, this.keyring);
      derivePkceChallenge(codeVerifier);
      return await this.create(verifiedPair(await this.provider.confirmEmail({ code, codeVerifier }), trusted.now), trusted.now);
    } catch (error) {
      if (error instanceof EmailAuthServiceError || error instanceof AuthProviderError) return providerFailure(error);
      return fail("AUTH_OAUTH_TRANSACTION_INVALID");
    }
  }

  private async create(pair: AuthTokenPair, now: Date): Promise<PublicSession> {
    const created = await this.sessions.create({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, userId: pair.userId, supabaseSessionId: pair.supabaseSessionId, accessTokenExpiresAt: pair.accessTokenExpiresAt }, now);
    return { selector: created.selector, user: pair.user, accessTokenExpiresAt: created.accessTokenExpiresAt, absoluteExpiresAt: created.absoluteExpiresAt };
  }
}
