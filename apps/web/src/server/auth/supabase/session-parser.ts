import "server-only";

import { CurrentUserSchema } from "@account-book/contracts";
import { PROVIDER_CLOCK_SKEW_SECONDS, validProviderIssuedAt } from "../../security/provider-time.js";
import type { AuthTokenPair } from "../auth-provider-port.js";
import { fail, mappedProviderError } from "./error-mapper.js";
import { object, token, uuid } from "./validation.js";
import { hasEmailLessSocialIdentity, type SocialSessionPolicy } from "./social-identity.js";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

/**
 * SDK 응답에서 오류를 먼저 확인하고 data가 객체인지 검사합니다.
 * @param value SDK 원시 응답.
 * @returns 검증된 data 객체.
 * @throws SDK 오류를 고정 코드로 바꾸거나 형식 오류를 던집니다.
 */
export function dataOf(value: unknown): Record<string, unknown> {
  const response = object(value);
  if (response.error !== null && response.error !== undefined) throw mappedProviderError(response.error);
  return object(response.data);
}

/**
 * 반환 데이터가 필요 없는 SDK 응답에서 error 유무를 확인합니다.
 * @param value SDK 원시 응답.
 * @returns 오류가 없으면 값 없이 종료합니다.
 * @throws SDK 오류 또는 응답 형식 오류.
 */
export function accepted(value: unknown): void {
  const response = object(value);
  if (response.error !== null && response.error !== undefined) throw mappedProviderError(response.error);
}

/**
 * JWT 한 구간이 빈 값 없는 표준 base64url인지 해독·재인코딩으로 확인합니다.
 * @param value JWT 헤더·페이로드·서명 구간.
 * @returns 검증된 원래 구간.
 * @throws 잘못된 표기이면 제공자 가용성 오류.
 */
function canonicalSegment(value: unknown): string {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return fail();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) return fail();
  return value;
}

/**
 * JWT의 세 구간과 사용자·세션 ID, 발급·만료 시각을 읽고 검사합니다. 이 함수 자체는 암호학적 서명 검증을 하지 않습니다.
 * @param accessToken 신뢰된 제공자 응답에서 받은 접근 JWT.
 * @returns 사용자 ID·제공자 세션 ID·발급 초·만료 초.
 * @throws 구조·JSON·클레임·시각 오류 시 제공자 가용성 오류.
 */
function jwtClaims(accessToken: string): Readonly<{ userId: string; sessionId: string; issuedAt: number; expiresAt: number; source: Record<string, unknown> }> {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return fail();
  try {
    canonicalSegment(parts[0]!);
    const payload = canonicalSegment(parts[1]!);
    canonicalSegment(parts[2]!);
    const claims = object(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const issuedAt = claims.iat;
    const expiresAt = claims.exp;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !validProviderIssuedAt(issuedAt, nowSeconds * 1000) ||
      typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt || expiresAt <= nowSeconds
    ) return fail();
    return { userId: uuid(claims.sub), sessionId: uuid(claims.session_id), issuedAt, expiresAt, source: claims };
  } catch { return fail(); }
}

/**
 * 제공자 세션의 토큰과 이메일 인증 사용자, JWT 소유자와 만료 시각을 공통 검증합니다.
 * @param sessionValue 제공자 세션 후보.
 * @param policy 이메일 없는 OAuth에만 적용하는 신뢰된 서버 정책. 생략 시 이메일 필수.
 * @returns 원본 세션 객체·내부 토큰 쌍·파싱한 클레임.
 * @throws 미인증 사용자 또는 응답 불일치 오류.
 */
function commonTokenPair(sessionValue: unknown, policy?: SocialSessionPolicy): Readonly<{ session: Record<string, unknown>; pair: AuthTokenPair; claims: ReturnType<typeof jwtClaims> }> {
  const session = object(sessionValue);
  const accessToken = token(session.access_token);
  const refreshToken = token(session.refresh_token);
  const user = object(session.user);
  const confirmation = user.email_confirmed_at;
  const confirmedAt = typeof confirmation === "string" ? new Date(confirmation) : new Date("invalid");
  const email = user.email === "" || user.email === undefined || user.email === null ? null : user.email;
  const parsedUser = CurrentUserSchema.safeParse({ id: user.id, email, emailVerified: email !== null && Number.isFinite(confirmedAt.getTime()) && confirmedAt.getTime() <= Date.now() + PROVIDER_CLOCK_SKEW_SECONDS * 1000 });
  if (!parsedUser.success) return fail("AUTH_EMAIL_VERIFICATION_REQUIRED");
  const claims = jwtClaims(accessToken);
  if (!parsedUser.data.emailVerified && !(email === null && hasEmailLessSocialIdentity(user, claims.source, policy))) return fail("AUTH_EMAIL_VERIFICATION_REQUIRED");
  const userId = uuid(user.id);
  if (claims.userId !== userId) return fail();
  const accessTokenExpiresAt = new Date(claims.expiresAt * 1000);
  if (!Number.isFinite(accessTokenExpiresAt.getTime()) || accessTokenExpiresAt.getTime() <= Date.now()) return fail();
  const pair = { accessToken, refreshToken, userId, supabaseSessionId: claims.sessionId, issuedAtSeconds: claims.issuedAt, accessTokenExpiresAt, user: parsedUser.data };
  return { session, pair, claims };
}

/**
 * SDK가 로컬 시각으로 계산할 수 있는 expires_at의 오차를 제한하고 실제 만료는 JWT exp를 사용합니다.
 * @param sessionValue SDK 세션 응답.
 * @param policy 갱신에서만 이메일 없는 기존 OAuth 세션을 허용한다. 생략 시 이메일 필수.
 * @returns 검증된 내부 토큰 쌍.
 * @throws 공통 검증 또는 만료값 불일치 오류.
 */
export function tokenPair(sessionValue: unknown, policy?: SocialSessionPolicy): AuthTokenPair {
  const { session, pair, claims } = commonTokenPair(sessionValue, policy);
  if (typeof session.expires_at !== "number" || !Number.isSafeInteger(session.expires_at) || Math.abs(claims.expiresAt - session.expires_at) > PROVIDER_CLOCK_SKEW_SECONDS) return fail();
  return pair;
}

/**
 * 직접 HTTP 세션의 bearer 타입·expires_in과 JWT 수명 일치 여부를 검증합니다.
 * @param sessionValue 직접 토큰 교환 JSON.
 * @param policy OAuth 트랜잭션에서 선택된 공급자. 이메일 확인·복구에서는 생략한다.
 * @returns 검증된 내부 토큰 쌍.
 * @throws 응답 형식·수명 불일치 오류.
 */
export function rawTokenPair(sessionValue: unknown, policy?: SocialSessionPolicy): AuthTokenPair {
  const { session, pair, claims } = commonTokenPair(sessionValue, policy);
  const expiresIn = session.expires_in;
  if (session.token_type !== "bearer" || typeof expiresIn !== "number" || !Number.isSafeInteger(expiresIn) || expiresIn <= 0 || claims.expiresAt - claims.issuedAt !== expiresIn) return fail();
  if (session.expires_at !== undefined && (typeof session.expires_at !== "number" || !Number.isSafeInteger(session.expires_at) || session.expires_at !== claims.expiresAt)) return fail();
  return pair;
}
