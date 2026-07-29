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

function isSafeAuthUiErrorCode(code: unknown): code is SafeAuthUiErrorCode {
  return typeof code === "string" && safeAuthUiErrorCodeSet.has(code);
}

export class SafeAuthUiError extends Error {
  readonly code: SafeAuthUiErrorCode;

  constructor(code: SafeAuthUiErrorCode) {
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

export function normalizeSafeAuthUiError(error: unknown): SafeAuthUiError {
  if (issuedSafeAuthUiErrors.has(error as SafeAuthUiError)) return error as SafeAuthUiError;
  return new SafeAuthUiError("AUTH_UI_UNEXPECTED_FAILURE");
}
