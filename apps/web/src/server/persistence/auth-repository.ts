import type { TokenEnvelope } from "../security/token-envelope.js";
import type { AuthProvider } from "@account-book/contracts";

/** A server-only persisted opaque session. Token values are always encrypted envelopes. */
export type AuthSessionRecord = Readonly<{
  id: string;
  selectorHash: Uint8Array;
  userId: string;
  supabaseSessionId: string;
  encryptedAccessToken: TokenEnvelope;
  encryptedRefreshToken: TokenEnvelope;
  accessTokenExpiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revocationPendingAt: Date | null;
  rotationVersion: number;
}>;

/** Complete encrypted input for creating an opaque session row. */
export type NewSessionRecord = AuthSessionRecord;

/** CAS preconditions and encrypted replacement data for exactly one token rotation. */
export type RotateSessionInput = Readonly<{
  sessionId: string;
  expectedRotationVersion: number;
  expectedSupabaseSessionId: string;
  encryptedAccessToken: TokenEnvelope;
  encryptedRefreshToken: TokenEnvelope;
  supabaseSessionId: string;
  accessTokenExpiresAt: Date;
  now: Date;
}>;

/** Persisted OAuth transaction containing only digests and an encrypted PKCE verifier. */
export type OAuthTransactionRecord = Readonly<{
  id: string;
  stateHash: Uint8Array;
  interactionHash: Uint8Array;
  provider: AuthProvider;
  encryptedPkceVerifier: TokenEnvelope;
  returnPath: "/app" | "/settings/security";
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}>;

/** Exact live-row predicates required to claim one OAuth code exchange. */
export type ClaimOAuthTransactionInput = Readonly<{
  provider: AuthProvider;
  stateHash: Uint8Array;
  interactionHash: Uint8Array;
  now: Date;
}>;

/** Persisted email-confirmation transaction containing one encrypted PKCE verifier. */
export type EmailConfirmationTransactionRecord = Readonly<{
  id: string;
  interactionHash: Uint8Array;
  encryptedPkceVerifier: TokenEnvelope;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}>;

/** Auditable fail-closed recovery transaction across pending, exchanged, update-claimed, and consumed stages. */
export type RecoveryTransactionRecord = Readonly<{
  id: string;
  interactionHash: Uint8Array;
  encryptedPkceVerifier: TokenEnvelope | null;
  userId: string | null;
  encryptedRecoveryToken: TokenEnvelope | null;
  createdAt: Date;
  expiresAt: Date;
  exchangeClaimedAt: Date | null;
  exchangedAt: Date | null;
  passwordUpdateClaimedAt: Date | null;
  consumedAt: Date | null;
}>;

/** CAS input that promotes exactly one claimed recovery exchange to encrypted credentials. */
export type PromoteRecoveryExchangeInput = Readonly<{
  transactionId: string;
  expectedExchangeClaimedAt: Date;
  userId: string;
  encryptedRecoveryToken: TokenEnvelope;
  now: Date;
}>;

/** CAS input that consumes one password update and revokes the user's local sessions atomically. */
export type ConsumeRecoveryInput = Readonly<{
  transactionId: string;
  userId: string;
  expectedPasswordUpdateClaimedAt: Date;
  now: Date;
}>;

/** Server-only persistence boundary; plaintext provider tokens never cross this port. */
export interface AuthRepository {
  createSession(input: NewSessionRecord, providerIssuedAtSeconds: number): Promise<boolean>;
  findActiveBySelectorHash(hash: Uint8Array, now: Date): Promise<AuthSessionRecord | null>;
  rotate(input: RotateSessionInput): Promise<boolean>;
  revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean>;
  revokeAllForUser(userId: string, now: Date): Promise<number>;
  markRevocationPending(sessionId: string, now: Date): Promise<void>;
  createOAuthTransaction(input: OAuthTransactionRecord): Promise<void>;
  claimOAuthTransaction(input: ClaimOAuthTransactionInput): Promise<OAuthTransactionRecord | null>;
  createEmailConfirmationTransaction(input: EmailConfirmationTransactionRecord): Promise<void>;
  claimEmailConfirmationTransaction(interactionHash: Uint8Array, now: Date): Promise<EmailConfirmationTransactionRecord | null>;
  createRecoveryTransaction(input: RecoveryTransactionRecord): Promise<void>;
  claimRecoveryExchange(interactionHash: Uint8Array, now: Date): Promise<RecoveryTransactionRecord | null>;
  promoteRecoveryExchange(input: PromoteRecoveryExchangeInput): Promise<boolean>;
  claimRecoveryPasswordUpdate(interactionHash: Uint8Array, now: Date): Promise<RecoveryTransactionRecord | null>;
  consumeRecoveryAndRevokeSessions(input: ConsumeRecoveryInput): Promise<boolean>;
}
