export const safeAuthUiErrorCodes = [
  "AUTH_UI_LOGIN_NOT_READY",
  "AUTH_UI_LAYOUT_FAILED",
  "AUTH_UI_ACCESSIBILITY_FAILED",
  "AUTH_UI_REJECTION_FAILED",
  "AUTH_UI_SESSION_POLICY_FAILED",
  "AUTH_UI_BROWSER_CREDENTIAL_DETECTED",
  "AUTH_UI_AUTHORIZATION_HEADER_DETECTED",
  "AUTH_UI_TRANSPORT_BLOCKED",
  "AUTH_UI_UNEXPECTED_FAILURE",
] as const;

export type SafeAuthUiErrorCode = typeof safeAuthUiErrorCodes[number];

const safeAuthUiErrorCodeSet = new Set<string>(safeAuthUiErrorCodes);
const issuedSafeAuthUiErrors = new WeakSet<SafeAuthUiError>();

/**
 * 오류 코드가 고정 공개 허용 목록에 있는지 검사한다.
 * @param code - 신뢰하지 않은 코드 후보다.
 * @returns 문자열이며 허용 목록에 있으면 true. 부작용은 없다.
 */
function isSafeAuthUiErrorCode(code: unknown): code is SafeAuthUiErrorCode {
  return typeof code === "string" && safeAuthUiErrorCodeSet.has(code);
}

export class SafeAuthUiError extends Error {
  readonly code: SafeAuthUiErrorCode;

  /**
   * 허용된 코드만 가진 동결 오류를 만들고 발급 사실을 WeakSet에 기록한다.
   * @param code - 단계별 공개 코드. 런타임 미지의 값은 일반 실패로 바뀐다.
   * @returns stack을 제거한 SafeAuthUiError 인스턴스.
   * @throws 상속 생성은 AUTH_UI_UNEXPECTED_FAILURE로 거부한다.
   */
  constructor(code: SafeAuthUiErrorCode) {
    if (new.target !== SafeAuthUiError) {
      throw new SafeAuthUiError("AUTH_UI_UNEXPECTED_FAILURE");
    }
    const fixedCode = isSafeAuthUiErrorCode(code)
      ? code
      : "AUTH_UI_UNEXPECTED_FAILURE";
    super(fixedCode);
    this.name = "SafeAuthUiError";
    this.code = fixedCode;
    Reflect.deleteProperty(this, "stack");
    issuedSafeAuthUiErrors.add(this);
    Object.freeze(this);
  }
}

/**
 * 실제로 이 모듈에서 발급한 오류만 보존하고 나머지는 일반 실패로 바꾼다.
 * @param error - catch로 받은 임의 값. 원본 속성을 읽지 않는다.
 * @returns 발급된 오류 또는 새 AUTH_UI_UNEXPECTED_FAILURE 오류다.
 */
export function normalizeSafeAuthUiError(error: unknown): SafeAuthUiError {
  if (issuedSafeAuthUiErrors.has(error as SafeAuthUiError)) return error as SafeAuthUiError;
  return new SafeAuthUiError("AUTH_UI_UNEXPECTED_FAILURE");
}
