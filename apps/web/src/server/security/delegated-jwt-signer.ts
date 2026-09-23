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
/**
 * 잘못된 서명 설정의 세부값을 숨기고 고정 오류를 던집니다.
 * @returns 반환하지 않습니다.
 * @throws AUTH_CONFIGURATION_INVALID.
 */
function invalidConfiguration(): never {
  throw new Error("AUTH_CONFIGURATION_INVALID");
}

/**
 * Collapses request-time signing failures so claims, entropy, request data, and tokens are never reflected.
 * @returns Never; this helper always throws the fixed public-safe signing error.
 * @throws `DELEGATED_JWT_INVALID` without contextual values.
 */
/**
 * 요청·토큰·키 정보를 노출하지 않고 서명 작업을 중단합니다.
 * @returns 반환하지 않습니다.
 * @throws DELEGATED_JWT_INVALID.
 */
function invalidToken(): never {
  throw new Error("DELEGATED_JWT_INVALID");
}

/**
 * Recognizes the canonical lowercase UUID representation shared by delegated token claims.
 * @param value Untrusted claim or generated request-ID candidate.
 * @returns Whether the value is a canonical UUID with a supported version and RFC variant.
 */
/**
 * 소문자 UUID가 지원 버전과 RFC variant 비트를 가진 표준 형태인지 확인합니다.
 * @param value 검사할 사용자·세션·요청 ID.
 * @returns 유효한 표준 UUID이면 true.
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
/**
 * P-256 개인키와 키 ID, 시계·난수 함수를 검증하고 기본 난수 함수를 채워 변경 불가 객체로 만듭니다.
 * @param dependencies 서버 전용 서명 설정.
 * @returns 검증·고정한 완전한 의존성 객체.
 * @throws 모든 설정 오류를 AUTH_CONFIGURATION_INVALID로 통일합니다.
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
/**
 * 완성된 JWT의 UTF-8 바이트 수가 계약상 최대 크기 이내인지 검사합니다.
 * @param token 서명 라이브러리의 출력 후보.
 * @returns 크기 검사를 통과한 문자열.
 * @throws 문자열이 아니거나 너무 크면 DELEGATED_JWT_INVALID.
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
  /**
   * 설정을 한 번 검증해 서명기 내부에 보관합니다. 이 단계에서는 토큰을 발급하지 않습니다.
   * @param dependencies P-256 개인키·키 ID·시계·선택적 난수 함수.
   * @throws 잘못된 설정이면 AUTH_CONFIGURATION_INVALID.
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
  /**
   * 사용자·세션·권한과 요청 내용을 검증하고, 본문 해시와 요청 메타데이터에 묶인 30초 ES256 JWT를 발급합니다. 일회 사용 여부는 수신 측에서 판정합니다.
   * @param input 실제 전송할 메서드·경로·본문·콘텐츠 타입과 사용자·세션·권한.
   * @returns 변경 불가 요청 ID와 서명된 JWT 쌍.
   * @throws 입력·시각·난수·서명 실패 시 DELEGATED_JWT_INVALID.
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
