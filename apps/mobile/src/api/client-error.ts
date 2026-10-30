import type { ApiErrorCode } from "@account-book/contracts";

export type ClientErrorCode =
  | ApiErrorCode
  | "CONFIGURATION"
  | "NETWORK"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "STORAGE"
  | "SESSION_CHANGED";

/** 원시 HTTP·저장소 예외를 UI/로그에 전달하지 않는 고정 코드 오류다. */
export class ClientError extends Error {
  /** @param code 허용된 오류 코드. @param status 서버가 반환한 HTTP 상태(있을 때만). */
  public constructor(
    public readonly code: ClientErrorCode,
    public readonly status?: number,
  ) {
    super(code);
  }
}

/** @param error 임의 예외. 키·토큰·서버 문구를 노출하지 않는 한국어 복구 안내를 반환한다. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ClientError))
    return "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
  switch (error.code) {
    case "AUTH_INVALID_CREDENTIALS":
      return "이메일과 비밀번호를 확인해 주세요.";
    case "AUTH_EMAIL_VERIFICATION_REQUIRED":
      return "이메일 인증을 마친 뒤 로그인해 주세요.";
    case "AUTH_RATE_LIMITED":
      return "요청이 많아요. 잠시 기다린 뒤 다시 시도해 주세요.";
    case "AUTH_SESSION_EXPIRED":
      return "로그인이 만료됐어요. 다시 로그인해 주세요.";
    case "STORAGE":
      return "기기 보안 저장소를 사용할 수 없어요. 정리 후 다시 시도해 주세요.";
    case "CONFIGURATION":
      return "서버 주소 설정이 필요해요. 개발용 서버 설정을 확인해 주세요.";
    case "NETWORK":
      return "서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.";
    case "SESSION_CHANGED":
      return "로그인 상태가 변경됐어요. 현재 계정에서 다시 확인해 주세요.";
    default:
      return "서비스 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
}
