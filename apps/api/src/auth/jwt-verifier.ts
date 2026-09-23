import { createHash, timingSafeEqual, type KeyObject } from "node:crypto";
import {
  DELEGATED_JWT_AUDIENCE,
  DELEGATED_JWT_ISSUER,
  DELEGATED_JWT_MAX_BYTES,
  DELEGATED_JWT_REPLAY_SECONDS,
  DELEGATED_JWT_TTL_SECONDS,
  DelegatedScopeSchema,
  canonicalDelegatedRequest,
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
  /** @returns 검증에 사용할 현재 시각. 생략하면 시스템 시계를 사용하며 테스트에서 고정할 수 있다. */
  now?: () => Date;
}>;

/** Injection token for the request-bound delegated verifier. */
export const ACCESS_TOKEN_VERIFIER = Symbol("ACCESS_TOKEN_VERIFIER");

/** Request-principal verification port accepting only a token bound to the current request. */
export interface AccessTokenVerifier {
  /**
   * 현재 요청에 묶인 위임 토큰을 검증하는 공개 호출 규약이다.
   * @param input - 토큰, 실제 HTTP 요청 정보, 경로가 요구하는 권한.
   * @returns 검증이 완료된 동결된 사용자·세션·권한·요청 ID 정보.
   * @throws 토큰 오류 또는 검증 불가 오류. 토큰 내부 내용은 오류에 포함하지 않는다.
   * @remarks 구현은 성공 전에 재사용 차단 저장소에 토큰 사용 사실을 기록한다.
   */
  verify(input: VerifyDelegatedTokenInput): Promise<AuthPrincipal>;
}

/** Fixed non-secret failure used for malformed, invalid, expired, mismatched, or replayed delegated tokens. */
export class InvalidAccessTokenError extends Error {
  /** 토큰이나 클레임 내용을 담지 않는 고정 인증 실패 객체를 만든다. */
  public constructor() {
    super("AUTH_ACCESS_TOKEN_INVALID");
    this.name = "InvalidAccessTokenError";
  }
}

/** Fixed non-secret failure used when verification is disabled or a required dependency cannot operate. */
export class AccessTokenVerificationUnavailableError extends Error {
  /** 내부 의존성 오류를 담지 않는 고정 검증 불가 객체를 만든다. */
  public constructor() {
    super("AUTH_VERIFICATION_UNAVAILABLE");
    this.name = "AccessTokenVerificationUnavailableError";
  }
}

/**
 * base64url 값을 디코딩하고 다시 인코딩해 같은 바이트의 다른 표기를 거부한다.
 * @param value - 토큰에서 읽은 미검증 필드값.
 * @param pattern - 해당 필드에 허용할 문자와 문자열 길이 정규식.
 * @param byteLength - 디코딩된 결과가 정확히 가져야 할 바이트 수.
 * @returns 표기와 길이 검증을 통과한 바이트 배열.
 * @throws 검사 실패 시 InvalidAccessTokenError.
 */
function decodeCanonicalBase64url(value: unknown, pattern: RegExp, byteLength: number): Uint8Array {
  if (typeof value !== "string" || !pattern.test(value)) throw new InvalidAccessTokenError();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== byteLength || bytes.toString("base64url") !== value) throw new InvalidAccessTokenError();
  return bytes;
}

/**
 * 서명이 검증된 JWT 내용도 다시 검사해 발급자·수신자·30초 수명·식별자·경로 권한을 제한한다.
 * @param payload - JOSE 서명 검증을 거친 토큰 내용. 필수 필드는 별도 검사한다.
 * @param requiredScope - 이 경로에 필요한 정확한 위임 권한.
 * @returns 토큰 ID, 요청 결합 해시, 발급 시각, 동결된 사용자 정보.
 * @throws 필수 값, UUID, 시간 관계, 권한, 인코딩이 맞지 않으면 InvalidAccessTokenError.
 */
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

/**
 * 실제 본문의 SHA-256을 계산하고 정규 요청 문자열을 다시 SHA-256으로 해시한다.
 * @param request - 메서드, URL, 콘텐츠 유형, 원문 바이트, 요청 ID.
 * @returns JWT의 rbh와 비교할 32바이트 해시. 요청이나 저장소는 변경하지 않는다.
 * @throws 요청 정규화가 실패하면 원래 오류 대신 InvalidAccessTokenError.
 */
function requestBinding(request: DelegatedRequestDescriptor): Uint8Array {
  try {
    const bodySha256 = createHash("sha256").update(request.body).digest("base64url");
    const canonical = canonicalDelegatedRequest({
      method: request.method,
      target: request.target,
      // The contracts helper owns content-type normalization; pre-normalizing `null`
      // to an empty string would turn an intentionally absent GET content type into invalid input.
      contentType: request.contentType,
      bodySha256,
      requestId: request.requestId,
    });
    return createHash("sha256").update(canonical).digest();
  } catch {
    throw new InvalidAccessTokenError();
  }
}

/**
 * JOSE 계열 오류인지 분류해 토큰 거부와 운영 장애의 응답 구분에 사용한다.
 * @param error - JWT 검증 중 발생한 임의의 오류.
 * @returns JOSEError의 인스턴스이면 true.
 */
function isInvalidJoseError(error: unknown): boolean {
  return error instanceof errors.JOSEError;
}

/**
 * 로컬 공개키로 ES256 위임 JWT를 검증하고 실제 요청과 일치할 때 토큰 사용을 한 번만 허용한다.
 * 인증 제공자에 조회하지 않으며 DB 재사용 차단까지 성공해야 사용자 정보를 돌려준다.
 */
export class DelegatedJwtVerifier implements AccessTokenVerifier {
  private readonly acceptedKids: ReadonlySet<string>;
  private readonly keyring: ReadonlyMap<string, VerificationKey>;
  private readonly now: () => Date;

  /**
   * 허용 키 목록과 공개키 맵을 복사해 이후 원본 목록 변경이 검증에 영향을 주지 않게 한다.
   * @param options - 인증 중지 스위치, 키 설정, 재사용 차단 저장소, 선택적 시계.
   * @remarks 저장소와 options 자체는 참조하며 생성 시 DB에 쓰거나 토큰을 검증하지 않는다.
   */
  public constructor(private readonly options: DelegatedJwtVerifierOptions) {
    this.acceptedKids = new Set(options.acceptedKids);
    this.keyring = new Map(Object.entries(options.keyring));
    this.now = options.now ?? (() => new Date());
  }

  /**
   * 헤더 → ES256 서명 → 필수 클레임 → 실제 요청 해시 → 토큰 재사용 차단 순서로 검사한다.
   * @param input - 위임 토큰과 그 토큰이 승인해야 하는 실제 요청 및 경로 권한.
   * @returns 재사용 저장소가 최초 사용을 인정한 뒤의 동결된 사용자 정보.
   * @throws 잘못된 토큰·불일치·재사용은 InvalidAccessTokenError, 중지 스위치·운영 장애는 검증 불가 오류.
   * @remarks 성공 시 토큰 ID의 SHA-256을 DB에 기록한다. 컨트롤러 처리 전부터 같은 토큰을 다시 쓸 수 없다.
   */
  public async verify(input: VerifyDelegatedTokenInput): Promise<AuthPrincipal> {
    if (this.options.authDisabled) throw new AccessTokenVerificationUnavailableError();
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
