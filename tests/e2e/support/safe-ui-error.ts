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

export class SafeAuthUiError extends Error {
  readonly code: SafeAuthUiErrorCode;

  constructor(code: SafeAuthUiErrorCode) {
    super(code);
    this.name = "SafeAuthUiError";
    this.code = code;
  }
}

export function normalizeSafeAuthUiError(error: unknown): SafeAuthUiError {
  if (error instanceof SafeAuthUiError) return error;
  return new SafeAuthUiError("AUTH_UI_UNEXPECTED_FAILURE");
}
