import { createHash, timingSafeEqual, type KeyObject } from "node:crypto";
import {
  DELEGATED_JWT_AUDIENCE,
  DELEGATED_JWT_ISSUER,
  DELEGATED_JWT_MAX_BYTES,
  DELEGATED_JWT_REPLAY_SECONDS,
  DELEGATED_JWT_TTL_SECONDS,
  DelegatedScopeSchema,
  canonicalDelegatedRequest,
  normalizeDelegatedContentType,
  type DelegatedScope,
} from "@account-book/contracts/internal-api";
import { decodeProtectedHeader, errors, jwtVerify, type CryptoKey } from "jose";
import type { ReplayStore } from "../persistence/replay-store.js";
import type { AuthPrincipal } from "./principal.js";

const SAFE_KEY_ID = /^[A-Za-z0-9._-]{1,128}$/u;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASE64URL_16 = /^[A-Za-z0-9_-]{22}$/u;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/u;
type VerificationKey = CryptoKey | KeyObject;

/** One concrete HTTP request whose canonical representation must match the delegated JWT binding. */
export type DelegatedRequestDescriptor = Readonly<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  target: string;
  contentType: string | null;
  body: Uint8Array;
  requestId: string;
}>;

/** Untrusted delegated token plus the request and scope it is authorized to perform. */
export type VerifyDelegatedTokenInput = Readonly<{
  token: string;
  request: DelegatedRequestDescriptor;
  requiredScope: DelegatedScope;
}>;

/** Immutable constructor dependencies for the static-key delegated JWT verifier. */
export type DelegatedJwtVerifierOptions = Readonly<{
  authDisabled: boolean;
  acceptedKids: readonly string[];
  keyring: Readonly<Record<string, VerificationKey>>;
  replayStore: ReplayStore;
  now?: () => Date;
}>;

/** Injection token for the request-bound verifier; legacy string calls fail closed during the Task 6 transition. */
export const ACCESS_TOKEN_VERIFIER = Symbol("ACCESS_TOKEN_VERIFIER");

/** Request-principal verification port retaining only a fail-closed compatibility signature for current consumers. */
export interface AccessTokenVerifier {
  /**
   * Verifies a request-bound delegated token.
   * @param input - New delegated input; a legacy raw string is rejected as unavailable.
   * @returns A frozen verified principal.
   * @throws A fixed invalid-token or unavailable error without token-derived detail.
   */
  verify(input: VerifyDelegatedTokenInput | string): Promise<AuthPrincipal>;
}

/** Fixed non-secret failure used for malformed, invalid, expired, mismatched, or replayed delegated tokens. */
export class InvalidAccessTokenError extends Error {
  /** Creates a detail-free invalid-token failure suitable for safe HTTP mapping. */
  public constructor() {
    super("AUTH_ACCESS_TOKEN_INVALID");
    this.name = "InvalidAccessTokenError";
  }
}

/** Fixed non-secret failure used when verification is disabled or a required dependency cannot operate. */
export class AccessTokenVerificationUnavailableError extends Error {
  /** Creates a detail-free unavailable failure without preserving dependency details. */
  public constructor() {
    super("AUTH_VERIFICATION_UNAVAILABLE");
    this.name = "AccessTokenVerificationUnavailableError";
  }
}

/** Decodes one canonical base64url field to its exact expected byte length. */
function decodeCanonicalBase64url(value: unknown, pattern: RegExp, byteLength: number): Uint8Array {
  if (typeof value !== "string" || !pattern.test(value)) throw new InvalidAccessTokenError();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== byteLength || bytes.toString("base64url") !== value) throw new InvalidAccessTokenError();
  return bytes;
}

/** Validates strict scalar, canonical claims after JOSE authenticates the payload. */
function validateClaims(payload: Record<string, unknown>, requiredScope: DelegatedScope): Readonly<{ jti: string; binding: Uint8Array; principal: AuthPrincipal; iat: number }> {
  const required = ["aud", "exp", "iat", "iss", "jti", "nbf", "rbh", "rid", "scp", "sid", "sub"];
  if (!required.every((claim) => Object.hasOwn(payload, claim))) throw new InvalidAccessTokenError();
  if (
    payload.iss !== DELEGATED_JWT_ISSUER
    || payload.aud !== DELEGATED_JWT_AUDIENCE
    || typeof payload.iat !== "number"
    || typeof payload.nbf !== "number"
    || typeof payload.exp !== "number"
    || !Number.isSafeInteger(payload.iat)
    || !Number.isSafeInteger(payload.nbf)
    || !Number.isSafeInteger(payload.exp)
    || payload.nbf !== payload.iat
    || payload.exp !== payload.iat + DELEGATED_JWT_TTL_SECONDS
    || typeof payload.sub !== "string"
    || !CANONICAL_UUID.test(payload.sub)
    || typeof payload.sid !== "string"
    || !CANONICAL_UUID.test(payload.sid)
    || typeof payload.rid !== "string"
    || !CANONICAL_UUID.test(payload.rid)
    || typeof payload.scp !== "string"
    || !DelegatedScopeSchema.safeParse(payload.scp).success
    || payload.scp !== requiredScope
  ) throw new InvalidAccessTokenError();
  const jti = decodeCanonicalBase64url(payload.jti, BASE64URL_16, 16);
  const binding = decodeCanonicalBase64url(payload.rbh, BASE64URL_32, 32);
  return {
    jti: Buffer.from(jti).toString("base64url"),
    binding,
    iat: payload.iat,
    principal: Object.freeze({ userId: payload.sub, sessionId: payload.sid, scope: payload.scp, requestId: payload.rid }),
  };
}

/** Builds the exact SHA-256 request-binding digest from the request without accepting ambiguous forms. */
function requestBinding(request: DelegatedRequestDescriptor): Uint8Array {
  try {
    const bodySha256 = createHash("sha256").update(request.body).digest("base64url");
    const canonical = canonicalDelegatedRequest({
      method: request.method,
      target: request.target,
      contentType: normalizeDelegatedContentType(request.contentType),
      bodySha256,
      requestId: request.requestId,
    });
    return createHash("sha256").update(canonical).digest();
  } catch {
    throw new InvalidAccessTokenError();
  }
}

/** Recognizes JOSE errors caused by attacker-controlled token data rather than local dependency failure. */
function isInvalidJoseError(error: unknown): boolean {
  return error instanceof errors.JOSEError;
}

/**
 * Verifies static-key ES256 delegated JWTs against exactly one bound request and consumes their replay identifier once.
 * @param options - Kill switch, immutable key snapshot source, replay store, and injected wall clock.
 * @returns A verifier that fails closed without contacting an identity provider.
 * @throws Construction does not retain mutable keyring or accepted-kid views.
 */
export class DelegatedJwtVerifier implements AccessTokenVerifier {
  private readonly acceptedKids: ReadonlySet<string>;
  private readonly keyring: ReadonlyMap<string, VerificationKey>;
  private readonly now: () => Date;

  /** Captures immutable snapshots of all server-owned verifier dependencies. */
  public constructor(private readonly options: DelegatedJwtVerifierOptions) {
    this.acceptedKids = new Set(options.acceptedKids);
    this.keyring = new Map(Object.entries(options.keyring));
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Validates header, signature, strict claims, request binding, then atomically consumes the replay identifier.
   * @param input - A delegated token with the request it must authorize; raw legacy strings fail closed.
   * @returns A frozen principal only after replay storage accepts the token exactly once.
   * @throws Fixed invalid-token failures for all token problems and fixed unavailable failures for disabled/operational state.
   */
  public async verify(input: VerifyDelegatedTokenInput | string): Promise<AuthPrincipal> {
    if (this.options.authDisabled || typeof input === "string") throw new AccessTokenVerificationUnavailableError();
    if (typeof input.token !== "string" || Buffer.byteLength(input.token, "utf8") > DELEGATED_JWT_MAX_BYTES) throw new InvalidAccessTokenError();
    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(input.token);
      if (header.alg !== "ES256" || header.typ !== "at+jwt" || header.crit !== undefined || typeof header.kid !== "string" || !SAFE_KEY_ID.test(header.kid)) {
        throw new InvalidAccessTokenError();
      }
    } catch {
      throw new InvalidAccessTokenError();
    }
    if (!this.acceptedKids.has(header.kid) || !this.keyring.has(header.kid)) throw new InvalidAccessTokenError();
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(input.token, this.keyring.get(header.kid)!, {
        algorithms: ["ES256"],
        audience: DELEGATED_JWT_AUDIENCE,
        issuer: DELEGATED_JWT_ISSUER,
        requiredClaims: ["aud", "exp", "iat", "iss", "jti", "nbf", "rbh", "rid", "scp", "sid", "sub"],
        clockTolerance: 5,
        currentDate: this.now(),
      });
      payload = verified.payload;
    } catch (error) {
      if (isInvalidJoseError(error)) throw new InvalidAccessTokenError();
      throw new AccessTokenVerificationUnavailableError();
    }
    const claims = validateClaims(payload, input.requiredScope);
    const recomputed = requestBinding(input.request);
    if (claims.binding.length !== recomputed.length || !timingSafeEqual(claims.binding, recomputed)) throw new InvalidAccessTokenError();
    const expiresAt = new Date((claims.iat + DELEGATED_JWT_REPLAY_SECONDS) * 1_000);
    if (!Number.isFinite(expiresAt.getTime())) throw new InvalidAccessTokenError();
    const digest = createHash("sha256").update(claims.jti, "utf8").digest();
    try {
      if (!await this.options.replayStore.consume(digest, expiresAt)) throw new InvalidAccessTokenError();
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) throw error;
      throw new AccessTokenVerificationUnavailableError();
    }
    return claims.principal;
  }
}

/**
 * Fail-closed Task 6 compatibility bridge for existing module wiring only.
 * @param _ignored - Legacy policy-shaped input, intentionally ignored and never used for key resolution.
 * @returns A verifier that rejects every raw-string legacy call as unavailable.
 * @throws Verification always fails with the fixed unavailable error when invoked.
 */
export function createRemoteAccessTokenVerifier(_ignored: unknown): AccessTokenVerifier {
  return { verify: async () => { throw new AccessTokenVerificationUnavailableError(); } };
}
