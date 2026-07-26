/** Injection token for the server-only delegated-JWT replay consumption boundary. */
export const REPLAY_STORE = Symbol("REPLAY_STORE");

/**
 * Fixed, detail-free failure for a digest or expiry that cannot satisfy the replay-store contract.
 * No rejected value is retained because callers may have supplied token-derived secret material.
 */
export class ReplayInputInvalidError extends Error {
  /** Creates the only caller-input failure emitted by a replay store. */
  public constructor() {
    super("REPLAY_INPUT_INVALID");
    this.name = "ReplayInputInvalidError";
  }
}

/**
 * Fixed, detail-free operational failure for unavailable or inconsistent replay persistence.
 * Driver errors, connection data, digests, expiries, and query details are intentionally discarded.
 */
export class ReplayStoreUnavailableError extends Error {
  /** Creates the only operational failure emitted by a replay store. */
  public constructor() {
    super("REPLAY_STORE_UNAVAILABLE");
    this.name = "ReplayStoreUnavailableError";
  }
}

/**
 * Atomically consumes SHA-256 delegated-token identifier digests without persisting raw token data.
 */
export interface ReplayStore {
  /**
   * Attempts to insert one exact 32-byte digest until its finite expiry.
   * @param jtiDigest - SHA-256 digest of the verified delegated JWT identifier; never a raw JTI.
   * @param expiresAt - Finite token expiry stored with the digest for owner-run cleanup.
   * @returns `true` for the first insert and `false` only when the digest already exists.
   * @throws `ReplayInputInvalidError` for invalid caller values or `ReplayStoreUnavailableError`
   * for operational/result failures, always without retaining secret details.
   */
  consume(jtiDigest: Uint8Array, expiresAt: Date): Promise<boolean>;
}
