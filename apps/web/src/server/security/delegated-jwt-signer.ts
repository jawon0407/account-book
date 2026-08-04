import {
  createHash,
  randomBytes,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import {
  canonicalDelegatedRequest,
  DELEGATED_JWT_AUDIENCE,
  DELEGATED_JWT_ISSUER,
  DELEGATED_JWT_MAX_BYTES,
  DELEGATED_JWT_TTL_SECONDS,
  DelegatedScopeSchema,
  type DelegatedScope,
} from "@account-book/contracts/internal-api";
import { SignJWT } from "jose";

const SAFE_KEY_ID = /^[A-Za-z0-9._-]{1,128}$/u;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type DelegatedSignInput = Readonly<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  target: string;
  contentType: string | null;
  body: Uint8Array;
  scope: DelegatedScope;
  userId: string;
  sessionId: string;
}>;

type SignerDependencies = Readonly<{
  keyId: string;
  privateKey: KeyObject;
  now: () => Date;
  randomBytes?: (size: number) => Buffer;
  randomUUID?: () => string;
}>;

/**
 * Collapses signer setup failures so parser or key details never cross the configuration boundary.
 * @returns Never; this helper always throws the fixed public-safe configuration error.
 * @throws `AUTH_CONFIGURATION_INVALID` without contextual values.
 */
function invalidConfiguration(): never {
  throw new Error("AUTH_CONFIGURATION_INVALID");
}

/**
 * Collapses request-time signing failures so claims, entropy, request data, and tokens are never reflected.
 * @returns Never; this helper always throws the fixed public-safe signing error.
 * @throws `DELEGATED_JWT_INVALID` without contextual values.
 */
function invalidToken(): never {
  throw new Error("DELEGATED_JWT_INVALID");
}

/**
 * Recognizes the canonical lowercase UUID representation shared by delegated token claims.
 * @param value Untrusted claim or generated request-ID candidate.
 * @returns Whether the value is a canonical UUID with a supported version and RFC variant.
 */
function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}

/**
 * Validates signer construction inputs before any request can observe a partially initialized signer.
 * @param dependencies Candidate server-only key material and runtime functions.
 * @returns A frozen, fully validated dependency snapshot.
 * @throws `AUTH_CONFIGURATION_INVALID` without reflecting candidate values for every failure.
 */
function validatedDependencies(dependencies: SignerDependencies): Required<SignerDependencies> {
  try {
    if (
      !SAFE_KEY_ID.test(dependencies.keyId) ||
      dependencies.privateKey.type !== "private" ||
      dependencies.privateKey.asymmetricKeyType !== "ec" ||
      dependencies.privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
      typeof dependencies.now !== "function" ||
      (dependencies.randomBytes !== undefined && typeof dependencies.randomBytes !== "function") ||
      (dependencies.randomUUID !== undefined && typeof dependencies.randomUUID !== "function")
    ) {
      return invalidConfiguration();
    }
    return Object.freeze({
      keyId: dependencies.keyId,
      privateKey: dependencies.privateKey,
      now: dependencies.now,
      randomBytes: dependencies.randomBytes ?? randomBytes,
      randomUUID: dependencies.randomUUID ?? randomUUID,
    });
  } catch {
    return invalidConfiguration();
  }
}

/**
 * Enforces the compact-token byte ceiling without reflecting token contents.
 * @param token Compact delegated JWT produced by the signing library.
 * @returns The unchanged token after its UTF-8 size is proven safe.
 * @throws `DELEGATED_JWT_INVALID` without secret detail when the output is invalid or oversized.
 */
export function assertDelegatedJwtSize(token: unknown): string {
  if (typeof token !== "string" || Buffer.byteLength(token, "utf8") > DELEGATED_JWT_MAX_BYTES) {
    return invalidToken();
  }
  return token;
}

/**
 * Mints a short-lived ES256 credential bound to exactly one canonical internal API request.
 * Constructor validation prevents an unsafe key, curve, key ID, or injected dependency from entering the request path.
 */
export class DelegatedJwtSigner {
  private readonly keyId: string;
  private readonly privateKey: KeyObject;
  private readonly now: () => Date;
  private readonly createRandomBytes: (size: number) => Buffer;
  private readonly createRandomUuid: () => string;

  /**
   * Validates and snapshots the server-only signing configuration once.
   * @param dependencies P-256 private key, safe rotation ID, clock, and optional testable CSPRNG functions.
  * @throws `AUTH_CONFIGURATION_INVALID` without key material or configuration values when validation fails.
   */
  public constructor(dependencies: SignerDependencies) {
    const validated = validatedDependencies(dependencies);
    this.keyId = validated.keyId;
    this.privateKey = validated.privateKey;
    this.now = validated.now;
    this.createRandomBytes = validated.randomBytes;
    this.createRandomUuid = validated.randomUUID;
  }

  /**
   * Canonicalizes request metadata and signs a one-use, 30-second delegated JWT.
   * @param input Exact outbound request plus canonical app user/session UUIDs and one allowlisted scalar scope.
   * @returns A frozen request ID and compact JWT pair for the same outbound request.
   * @throws `DELEGATED_JWT_INVALID` without claim, request, randomness, or key detail for every runtime failure.
   */
  public async sign(input: DelegatedSignInput): Promise<Readonly<{ requestId: string; token: string }>> {
    try {
      if (
        !isCanonicalUuid(input.userId) ||
        !isCanonicalUuid(input.sessionId) ||
        !DelegatedScopeSchema.safeParse(input.scope).success ||
        !(input.body instanceof Uint8Array)
      ) {
        return invalidToken();
      }

      const instant = this.now();
      const milliseconds = instant instanceof Date ? instant.getTime() : Number.NaN;
      const issuedAt = Math.floor(milliseconds / 1_000);
      if (
        !Number.isFinite(milliseconds) ||
        !Number.isSafeInteger(issuedAt) ||
        issuedAt < 0 ||
        !Number.isSafeInteger(issuedAt + DELEGATED_JWT_TTL_SECONDS)
      ) {
        return invalidToken();
      }

      const requestId = this.createRandomUuid();
      if (!isCanonicalUuid(requestId)) return invalidToken();
      const entropy = this.createRandomBytes(16);
      if (!Buffer.isBuffer(entropy) || entropy.byteLength !== 16) return invalidToken();

      const bodySha256 = createHash("sha256").update(input.body).digest("base64url");
      const requestBinding = canonicalDelegatedRequest({
        bodySha256,
        contentType: input.contentType,
        method: input.method,
        requestId,
        target: input.target,
      });
      const rbh = createHash("sha256").update(requestBinding, "utf8").digest("base64url");
      const token = await new SignJWT({
        rbh,
        rid: requestId,
        scp: input.scope,
        sid: input.sessionId,
      })
        .setProtectedHeader({ alg: "ES256", kid: this.keyId, typ: "at+jwt" })
        .setIssuer(DELEGATED_JWT_ISSUER)
        .setAudience(DELEGATED_JWT_AUDIENCE)
        .setSubject(input.userId)
        .setJti(entropy.toString("base64url"))
        .setIssuedAt(issuedAt)
        .setNotBefore(issuedAt)
        .setExpirationTime(issuedAt + DELEGATED_JWT_TTL_SECONDS)
        .sign(this.privateKey);

      return Object.freeze({ requestId, token: assertDelegatedJwtSize(token) });
    } catch {
      return invalidToken();
    }
  }
}
