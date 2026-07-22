import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { AuthPrincipal } from "./principal.js";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Injection token for the verifier that establishes authenticated request principals. */
export const ACCESS_TOKEN_VERIFIER = Symbol("ACCESS_TOKEN_VERIFIER");

/** Exact issuer, audience, and asymmetric algorithm required for accepted access JWTs. */
export type JwtVerificationPolicy = Readonly<{
  issuer: string;
  audience: string;
  algorithm: "ES256" | "RS256";
}>;

/** Production JWT policy with the prevalidated remote key-set URL. */
export type RemoteJwtVerificationPolicy = JwtVerificationPolicy & Readonly<{ jwksUrl: string }>;

/**
 * Verifies an untrusted compact access token and returns only its authorization principal.
 */
export interface AccessTokenVerifier {
  /**
   * Checks protected-header structure/extensions, algorithm, signature, registered claims, then canonical UUID claims.
   * @param token - A bounded compact JWT extracted from one canonical Bearer header.
   * @returns The verified user and session IDs, with all other claims discarded.
   * @throws A fixed invalid-token or unavailable error; verification never falls back to unverified data.
   */
  verify(token: string): Promise<AuthPrincipal>;
}

/** Fixed non-secret failure used for every malformed or invalid access token. */
export class InvalidAccessTokenError extends Error {
  /** Creates a detail-free invalid-token failure suitable for safe HTTP mapping. */
  public constructor() {
    super("AUTH_ACCESS_TOKEN_INVALID");
    this.name = "InvalidAccessTokenError";
  }
}

/** Fixed non-secret failure used when key verification cannot operate safely. */
export class AccessTokenVerificationUnavailableError extends Error {
  /** Creates a detail-free operational failure; provider errors are intentionally not retained. */
  public constructor() {
    super("AUTH_VERIFICATION_UNAVAILABLE");
    this.name = "AccessTokenVerificationUnavailableError";
  }
}

function invalidJoseError(error: unknown): boolean {
  return error instanceof errors.JWTClaimValidationFailed
    || error instanceof errors.JWTExpired
    || error instanceof errors.JWTInvalid
    || error instanceof errors.JWSInvalid
    || error instanceof errors.JWSSignatureVerificationFailed
    || error instanceof errors.JOSEAlgNotAllowed
    || error instanceof errors.JWKSNoMatchingKey
    || error instanceof errors.JWKSMultipleMatchingKeys;
}

/**
 * Verifies JWTs with an explicitly supplied JOSE key resolver.
 * Protected-header validation precedes signature and registered-claim validation, then exact-audience
 * and UUID checks run; every invalid path fails closed to one detail-free error.
 */
export class JwtAccessTokenVerifier implements AccessTokenVerifier {
  /**
   * @param policy - Exact issuer, audience, and asymmetric algorithm allowlist.
   * @param resolveKey - JOSE key resolver; tests may inject a local ES256 resolver.
   */
  public constructor(
    private readonly policy: JwtVerificationPolicy,
    private readonly resolveKey: JWTVerifyGetKey,
  ) {}

  /**
   * Validates protected-header structure/extensions, algorithm, signature, issuer/audience/time claims, then UUID claims.
   * @param token - One bounded compact JWT from the HTTP guard.
   * @returns A frozen principal containing only verified `sub` and `session_id` values.
   * @throws Fixed errors for invalid tokens or operational key failures; unverified claims are never returned.
   */
  public async verify(token: string): Promise<AuthPrincipal> {
    try {
      // Critical extensions change verification semantics; this boundary opts into none.
      if (decodeProtectedHeader(token).crit !== undefined) throw new InvalidAccessTokenError();
    } catch {
      throw new InvalidAccessTokenError();
    }
    try {
      const { payload } = await jwtVerify(token, this.resolveKey, {
        algorithms: [this.policy.algorithm],
        audience: this.policy.audience,
        issuer: this.policy.issuer,
        requiredClaims: ["exp", "sub", "session_id"],
      });
      if (
        payload.aud !== this.policy.audience
        || typeof payload.sub !== "string"
        || !CANONICAL_UUID.test(payload.sub)
        || typeof payload.session_id !== "string"
        || !CANONICAL_UUID.test(payload.session_id)
      ) throw new InvalidAccessTokenError();
      return Object.freeze({ userId: payload.sub, sessionId: payload.session_id });
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) throw error;
      if (invalidJoseError(error)) throw new InvalidAccessTokenError();
      throw new AccessTokenVerificationUnavailableError();
    }
  }
}

/**
 * Creates the production verifier backed by JOSE's remotely refreshed JWKS resolver.
 * @param policy - Prevalidated JWKS URL plus exact issuer, audience, and algorithm values.
 * @returns A verifier that performs remote key resolution before claim and UUID validation.
 * @throws URL construction or remote key failures fail closed and never enable a local fallback.
 */
export function createRemoteAccessTokenVerifier(policy: RemoteJwtVerificationPolicy): AccessTokenVerifier {
  return new JwtAccessTokenVerifier(policy, createRemoteJWKSet(new URL(policy.jwksUrl)));
}
