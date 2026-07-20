import { randomUUID } from "node:crypto";
import { CurrentUserSchema, PasswordResetRequestInputSchema, PasswordUpdateInputSchema } from "@account-book/contracts";
import type { AuthRepository, RecoveryTransactionRecord } from "../persistence/auth-repository.js";
import { createPkceVerifier, derivePkceChallenge } from "../security/pkce.js";
import { hashSessionSelector } from "../security/session-selector.js";
import { decryptToken, encryptToken, type TokenKeyring } from "../security/token-envelope.js";
import { AuthProviderError, type AuthProviderErrorCode, type AuthProviderPort, type RecoveryContext } from "./auth-provider-port.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const RECOVERY_LIFETIME_MS = 15 * 60_000;

/** Trusted callback, pre-auth interaction, and time for one recovery operation. */
export type PasswordRecoveryContext = Readonly<{ passwordResetRedirectUrl: URL; interactionSelector: string; now: Date }>;
type RecoveryRepository = Pick<AuthRepository, "createRecoveryTransaction" | "claimRecoveryExchange" | "promoteRecoveryExchange" | "claimRecoveryPasswordUpdate" | "consumeRecoveryAndRevokeSessions">;
type RecoveryProvider = Pick<AuthProviderPort, "requestPasswordReset" | "exchangeRecoveryCode" | "updatePassword">;
type CredentialPair = Readonly<{ accessToken: string; refreshToken: string }>;

/** Fixed recovery use-case error that never includes email, code, verifier, credential, or selector values. */
export class PasswordRecoveryServiceError extends Error {
  /** Creates one allowlisted recovery failure without retaining submitted values. */
  public constructor(public readonly code: AuthProviderErrorCode = "AUTH_OAUTH_TRANSACTION_INVALID") {
    super(code);
    this.name = "PasswordRecoveryServiceError";
  }
}

function fail(code: AuthProviderErrorCode = "AUTH_OAUTH_TRANSACTION_INVALID"): never { throw new PasswordRecoveryServiceError(code); }
function validDate(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
function safeCode(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail();
  return value;
}
function safeToken(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail();
  return value;
}
function safeUrl(value: unknown): URL {
  if (!(value instanceof URL)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  const url = new URL(value.toString());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || url.hash !== "" || !(url.protocol === "https:" || (local && url.protocol === "http:"))) return fail("AUTH_PROVIDER_UNAVAILABLE");
  return url;
}
function context(value: PasswordRecoveryContext): Readonly<PasswordRecoveryContext & { interactionHash: Uint8Array }> {
  if (!validDate(value?.now)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  let interactionHash: Uint8Array;
  try { interactionHash = hashSessionSelector(value?.interactionSelector); } catch { return fail(); }
  return { passwordResetRedirectUrl: safeUrl(value?.passwordResetRedirectUrl), interactionSelector: value.interactionSelector, interactionHash, now: value.now };
}
function shifted(now: Date): Date {
  const expiresAt = new Date(now.getTime() + RECOVERY_LIFETIME_MS);
  if (!validDate(expiresAt)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  return expiresAt;
}
function commonRecord(record: RecoveryTransactionRecord, interactionHash: Uint8Array, now: Date): RecoveryTransactionRecord {
  if (
    !validUuid(record?.id) || !(record?.interactionHash instanceof Uint8Array) || record.interactionHash.length !== 32 || !Buffer.from(record.interactionHash).equals(Buffer.from(interactionHash)) ||
    !validDate(record?.createdAt) || !validDate(record?.expiresAt) || record.expiresAt.getTime() <= now.getTime() || record.expiresAt.getTime() - record.createdAt.getTime() !== RECOVERY_LIFETIME_MS
  ) return fail();
  return record;
}
function claimedExchange(record: RecoveryTransactionRecord, interactionHash: Uint8Array, now: Date): RecoveryTransactionRecord {
  const row = commonRecord(record, interactionHash, now);
  if (row.encryptedPkceVerifier === null || row.userId !== null || row.encryptedRecoveryToken !== null || !validDate(row.exchangeClaimedAt) || row.exchangedAt !== null || row.passwordUpdateClaimedAt !== null || row.consumedAt !== null) return fail();
  return row;
}
function claimedUpdate(record: RecoveryTransactionRecord, interactionHash: Uint8Array, now: Date): RecoveryTransactionRecord {
  const row = commonRecord(record, interactionHash, now);
  if (row.encryptedPkceVerifier !== null || !validUuid(row.userId) || row.encryptedRecoveryToken === null || !validDate(row.exchangeClaimedAt) || !validDate(row.exchangedAt) || !validDate(row.passwordUpdateClaimedAt) || row.consumedAt !== null || row.exchangeClaimedAt.getTime() > row.exchangedAt.getTime() || row.exchangedAt.getTime() > row.passwordUpdateClaimedAt.getTime()) return fail();
  return row;
}
function recoveryCredentials(value: RecoveryContext): Readonly<{ userId: string; credentials: CredentialPair }> {
  const user = CurrentUserSchema.safeParse(value?.user);
  if (!user.success || !user.data.emailVerified || !validUuid(user.data.id)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  return { userId: user.data.id, credentials: { accessToken: safeToken(value?.accessToken), refreshToken: safeToken(value?.refreshToken) } };
}
function canonicalCredentials(value: string): CredentialPair {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return fail();
    const object = parsed as Record<string, unknown>;
    const keys = Object.keys(object);
    if (keys.length !== 2 || keys[0] !== "accessToken" || keys[1] !== "refreshToken") return fail();
    const credentials = { accessToken: safeToken(object.accessToken), refreshToken: safeToken(object.refreshToken) };
    if (JSON.stringify(credentials) !== value) return fail();
    return credentials;
  } catch { return fail(); }
}
function providerFailure(error: unknown): never {
  if (error instanceof PasswordRecoveryServiceError) throw error;
  if (error instanceof AuthProviderError) return fail(error.code);
  return fail("AUTH_PROVIDER_UNAVAILABLE");
}

/** Owns recovery PKCE creation, one-shot exchange promotion, and one-shot password update consumption. */
export class PasswordRecoveryService {
  /** Installs narrow transaction/provider ports and injectable cryptographic generators. */
  public constructor(
    private readonly repository: RecoveryRepository,
    private readonly provider: RecoveryProvider,
    private readonly keyring: TokenKeyring,
    private readonly createId: () => string = randomUUID,
    private readonly createVerifier: () => string = createPkceVerifier,
  ) {}

  /**
   * Stores a fifteen-minute pending verifier before reset delivery.
   * @param email - The untrusted recovery email.
   * @param recoveryContext - Trusted callback, interaction, and time.
   * @returns The account-enumeration-resistant acknowledgement.
   * @throws A fixed auth code for invalid input or unavailable dependencies.
   */
  public async start(email: unknown, recoveryContext: PasswordRecoveryContext): Promise<Readonly<{ accepted: true }>> {
    try {
      const parsed = PasswordResetRequestInputSchema.safeParse({ email });
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      const trusted = context(recoveryContext);
      const id = this.createId();
      if (!validUuid(id)) return fail("AUTH_PROVIDER_UNAVAILABLE");
      const verifier = this.createVerifier();
      const challenge = derivePkceChallenge(verifier);
      await this.repository.createRecoveryTransaction({
        id,
        interactionHash: trusted.interactionHash,
        encryptedPkceVerifier: encryptToken(verifier, { recordId: id, tokenKind: "pkce" }, this.keyring),
        userId: null,
        encryptedRecoveryToken: null,
        createdAt: new Date(trusted.now),
        expiresAt: shifted(trusted.now),
        exchangeClaimedAt: null,
        exchangedAt: null,
        passwordUpdateClaimedAt: null,
        consumedAt: null,
      });
      await this.provider.requestPasswordReset(parsed.data.email, trusted.passwordResetRedirectUrl, challenge);
      return { accepted: true };
    } catch (error) {
      if (error instanceof AuthProviderError && error.code === "AUTH_INVALID_CREDENTIALS") return { accepted: true };
      return providerFailure(error);
    }
  }

  /**
   * Claims a pending row before exchanging the recovery code.
   * @param input - The server callback code.
   * @param recoveryContext - Trusted callback interaction and time.
   * @returns A public readiness marker without provider credentials.
   * @throws A fixed auth code for malformed, expired, replayed, or failed exchange.
   */
  public async exchange(input: Readonly<{ code: string }>, recoveryContext: PasswordRecoveryContext): Promise<Readonly<{ ready: true }>> {
    try {
      const code = safeCode(input?.code);
      const trusted = context(recoveryContext);
      const transaction = await this.repository.claimRecoveryExchange(trusted.interactionHash, new Date(trusted.now));
      if (transaction === null) return fail();
      const record = claimedExchange(transaction, trusted.interactionHash, trusted.now);
      const codeVerifier = decryptToken(record.encryptedPkceVerifier, { recordId: record.id, tokenKind: "pkce" }, this.keyring);
      derivePkceChallenge(codeVerifier);
      const recovered = recoveryCredentials(await this.provider.exchangeRecoveryCode({ code, codeVerifier }));
      const encryptedRecoveryToken = encryptToken(JSON.stringify(recovered.credentials), { recordId: record.id, tokenKind: "recovery" }, this.keyring);
      const promoted = await this.repository.promoteRecoveryExchange({ transactionId: record.id, expectedExchangeClaimedAt: new Date(record.exchangeClaimedAt!), userId: recovered.userId, encryptedRecoveryToken, now: new Date(trusted.now) });
      if (!promoted) return fail();
      return { ready: true };
    } catch (error) {
      if (error instanceof PasswordRecoveryServiceError || error instanceof AuthProviderError) return providerFailure(error);
      return fail();
    }
  }

  /**
   * Claims one exchanged row and updates the matching provider user.
   * @param input - The new password validated at this boundary.
   * @param recoveryContext - Trusted interaction and time.
   * @returns A public success marker after atomic consumption and local revocation.
   * @throws A fixed auth code for invalid, replayed, mismatched, malformed, or failed updates.
   */
  public async update(input: Readonly<{ password: string }>, recoveryContext: PasswordRecoveryContext): Promise<Readonly<{ updated: true }>> {
    try {
      const password = PasswordUpdateInputSchema.safeParse(input);
      if (!password.success) return fail("AUTH_INVALID_CREDENTIALS");
      const trusted = context(recoveryContext);
      const transaction = await this.repository.claimRecoveryPasswordUpdate(trusted.interactionHash, new Date(trusted.now));
      if (transaction === null) return fail();
      const record = claimedUpdate(transaction, trusted.interactionHash, trusted.now);
      const credentials = canonicalCredentials(decryptToken(record.encryptedRecoveryToken, { recordId: record.id, tokenKind: "recovery" }, this.keyring));
      await this.provider.updatePassword({ ...credentials, userId: record.userId!, password: password.data.password });
      const consumed = await this.repository.consumeRecoveryAndRevokeSessions({ transactionId: record.id, userId: record.userId!, expectedPasswordUpdateClaimedAt: new Date(record.passwordUpdateClaimedAt!), now: new Date(trusted.now) });
      if (!consumed) return fail();
      return { updated: true };
    } catch (error) {
      if (error instanceof PasswordRecoveryServiceError || error instanceof AuthProviderError) return providerFailure(error);
      return fail();
    }
  }
}
