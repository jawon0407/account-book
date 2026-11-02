import type { BankConnectionRequestStatus } from "@account-book/contracts";
import { ApiClientError } from "../../../lib/http/api-client.js";

/** 공개 상태만 문구에 매핑한다. 원본 은행 오류나 계좌 식별자는 표시하지 않는다. */
export const statusCopy: Record<BankConnectionRequestStatus["status"], readonly [string, string]> = {
  awaiting_callback: ["은행 인증을 기다리고 있어요", "은행 인증 화면에서 동의를 마친 뒤 돌아와 주세요. 진행하지 않으면 요청이 만료돼요."],
  awaiting_completion: ["마지막 확인이 필요해요", "이 브라우저에서 시작한 연결인지 확인해 주세요. 아래 버튼을 누르면 서버에서 연결 인증을 완료해요."],
  exchanging: ["연결을 확인하고 있어요", "은행에 요청을 보냈어요. 완료 버튼을 다시 누르지 말고 잠시 후 상태를 새로고침해 주세요."],
  connected: ["연결 인증을 완료했어요", "잔액·입출금 조회는 후속 단계에서 제공해요. 인증 완료만으로 거래가 자동 수집되지는 않아요."],
  cancelled: ["은행 연결이 취소됐어요", "동의가 완료되지 않았어요. 필요한 경우 새 연결을 시작해 주세요."],
  expired: ["연결 시간이 지났어요", "안전을 위해 이 요청을 사용할 수 없어요. 새 연결을 시작해 주세요."],
  failed: ["은행 연결을 완료하지 못했어요", "같은 인증을 반복 전송하지 않아요. 새 연결로 다시 시작해 주세요."],
};
/** @param error 정규화한 오류. @returns 사용자가 취할 행동; 공급자 원문은 무시한다. */
export function bankMessage(error: unknown): string {
  const code = error instanceof ApiClientError ? error.code : null;
  if (code === "BANK_RATE_LIMITED") return "연결 요청이 많아요. 잠시 기다린 뒤 다시 시작해 주세요.";
  if (code === "BANK_REQUEST_NOT_FOUND") return "이 계정과 세션에서 확인할 수 없는 연결이에요. 연결을 시작했던 계정으로 로그인해 주세요.";
  if (code === "BANK_REQUEST_CONFLICT") return "연결 확인값이 만료됐거나 이미 처리된 요청이에요. 상태를 확인한 뒤 필요한 경우 새로 시작해 주세요.";
  if (code === "AUTH_CSRF_REJECTED") return "요청을 확인할 수 없어요. 새로고침한 뒤 연결 상태부터 확인해 주세요.";
  return "연결 결과를 확인하지 못했어요. 같은 요청을 다시 보내지 말고 상태를 새로고침해 주세요.";
}
