import type { TokenEnvelope } from "../security/token-envelope.js";

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

/** Server-only persistence boundary; plaintext provider tokens never cross this port. */
export interface AuthRepository {
  create(input: NewSessionRecord): Promise<void>;
  findActiveBySelectorHash(hash: Uint8Array, now: Date): Promise<AuthSessionRecord | null>;
  rotate(input: RotateSessionInput): Promise<boolean>;
  revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean>;
  revokeAllForUser(userId: string, now: Date): Promise<number>;
  markRevocationPending(sessionId: string, now: Date): Promise<void>;
}
