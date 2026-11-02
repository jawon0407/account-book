export type BankErrorCode = "BANK_INVALID_REQUEST" | "BANK_REQUEST_NOT_FOUND" | "BANK_REQUEST_CONFLICT" | "BANK_RATE_LIMITED" | "BANK_UNAVAILABLE";
/** 원시 SQL·은행 응답·비밀값 대신 고정 코드만 HTTP 경계로 전달한다. */
export class BankError extends Error {
  /** @param code 공개 고정 코드. @param status HTTP 상태. @param retryAfter 재시도 대기 초(429 전용). */
  public constructor(public readonly code: BankErrorCode, public readonly status: 400 | 404 | 409 | 429 | 503, public readonly retryAfter?: number) {
    super(code); this.name = "BankError";
  }
}
/** @returns 상세 예외를 포함하지 않는 안전한 장애. 자동 코드 재교환을 허용하지 않는다. */
export function bankUnavailable(): BankError { return new BankError("BANK_UNAVAILABLE", 503); }
