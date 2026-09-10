import "server-only";

import { AuthProviderError, type AuthProviderErrorCode } from "../auth-provider-port.js";

const SIGNUP_EXISTENCE_CODES = new Set(["user_already_exists", "email_exists", "user_already_registered", "email_already_exists", "user_already_exist"]);
const RESET_ABSENT_CODES = new Set(["user_not_found", "email_not_found", "user_not_exist", "email_not_exists", "user_does_not_exist"]);
const PKCE_TRANSACTION_CODES = new Set(["invalid_grant", "bad_code_verifier", "flow_state_expired", "flow_state_not_found", "otp_expired", "otp_disabled"]);
const EXPECTED_DISCLOSURE_STATUSES = new Set([400, 422]);

/**
 * 제공자 내부값을 숨긴 고정 코드로 작업을 중단합니다.
 * @param code 공개 가능한 실패 코드.
 * @returns 반환하지 않습니다.
 * @throws AuthProviderError.
 */
export function fail(code: AuthProviderErrorCode = "AUTH_PROVIDER_UNAVAILABLE"): never { throw new AuthProviderError(code); }

/**
 * 외부 오류 객체에서 문자열 code만 안전하게 골라냅니다.
 * @param value 제공자 응답 후보.
 * @returns 문자열 오류 코드 또는 없으면 빈 문자열.
 */
export function providerCode(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
}

/**
 * HTTP 상태와 가입 존재 오류 코드를 함께 검사해 계정 열거 방지 응답인지 판별합니다.
 * @param body 제공자 오류 본문.
 * @param status 직접 HTTP 응답 상태.
 * @returns 공개 응답으로 감춰야 하는 가입 존재 오류이면 true.
 */
export function isSignupExistenceResponse(body: unknown, status: number): boolean {
  return EXPECTED_DISCLOSURE_STATUSES.has(status) && SIGNUP_EXISTENCE_CODES.has(providerCode(body));
}

/**
 * HTTP 상태와 복구 계정 부재 오류 코드를 함께 검사해 계정 열거 방지 응답인지 판별합니다.
 * @param body 제공자 오류 본문.
 * @param status 직접 HTTP 응답 상태.
 * @returns 성공으로 감춰야 하는 복구 계정 부재 오류이면 true.
 */
export function isResetAbsenceResponse(body: unknown, status: number): boolean {
  return EXPECTED_DISCLOSURE_STATUSES.has(status) && RESET_ABSENT_CODES.has(providerCode(body));
}

/**
 * HTTP/SDK 오류와 PKCE 교환 여부에 따라 제한·미인증·잘못된 자격 증명·트랜잭션·가용성의 허용 코드로 변환합니다.
 * @param value 원시 제공자 오류.
 * @param status 직접 HTTP 응답의 상태 코드; SDK일 때 생략.
 * @param pkce PKCE 교환 실패인지 여부.
 * @returns 민감한 원문을 담지 않은 AuthProviderError.
 */
export function mappedProviderError(value: unknown, status?: number, pkce = false): AuthProviderError {
  const error = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const isHttp = status !== undefined;
  const providerStatus = status ?? (typeof error.status === "number" ? error.status : undefined);
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (providerStatus === 429 || (!isHttp && (code === "over_request_rate_limit" || code === "rate_limit_exceeded"))) return new AuthProviderError("AUTH_RATE_LIMITED");
  if (!isHttp && (code === "email_not_confirmed" || message === "email not confirmed")) return new AuthProviderError("AUTH_EMAIL_VERIFICATION_REQUIRED");
  if (pkce) {
    if ((providerStatus === 400 || providerStatus === 401) && PKCE_TRANSACTION_CODES.has(code)) return new AuthProviderError("AUTH_OAUTH_TRANSACTION_INVALID");
    return new AuthProviderError();
  }
  if (isHttp) return new AuthProviderError();
  if (providerStatus === 400 || providerStatus === 401 || ["invalid_credentials", "invalid_grant", "bad_code_verifier"].includes(code)) return new AuthProviderError("AUTH_INVALID_CREDENTIALS");
  if (["flow_state_expired", "flow_state_not_found", "otp_expired", "otp_disabled", "same_password"].includes(code)) return new AuthProviderError("AUTH_OAUTH_TRANSACTION_INVALID");
  return new AuthProviderError();
}

/**
 * 알려진 제공자 오류는 identity를 유지하고 알 수 없는 오류는 고정 가용성 오류로 바꿉니다.
 * @param error 처리 중 발생한 오류.
 * @returns 반환하지 않습니다.
 * @throws AuthProviderError.
 */
export function rethrowProviderError(error: unknown): never {
  if (error instanceof AuthProviderError) throw error;
  return fail();
}
