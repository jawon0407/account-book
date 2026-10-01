import type { ApiErrorCode } from "@account-book/contracts";

/** 내부 원문 대신 공개 가능한 코드·상태만 전달하는 도메인 오류다. */
export class CoreError extends Error {
  /** @param code 고정 공개 코드. @param status HTTP 상태. @param retryable 재시도 허용 여부. */
  public constructor(public readonly code: ApiErrorCode, public readonly status: 400 | 401 | 404 | 409 | 503, public readonly retryable = false) {
    super(code); this.name = "CoreError";
  }
}
/** @returns 내부 DB·SQL·응답 변환 실패를 숨기는 고정 서비스 장애. */
export function unavailable(): CoreError { return new CoreError("LEDGER_SERVICE_UNAVAILABLE", 503, true); }
