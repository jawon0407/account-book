import type {
  CollectorChangeInput,
  CollectorState,
} from "@account-book/contracts";
import { ClientError } from "../api/client-error";

export const COLLECTOR_PREPARATION =
  "수집 기기 지정·이 기기의 동의 저장·Android 권한 설정을 준비할 수 있어요. 금융 앱·문자·카카오톡 알림을 읽거나 거래로 저장하지 않아요.";

/** @param state 서버가 확인한 지정 상태. 알림 수집 중이라는 표현은 사용하지 않는다. */
export function collectorStateCopy(state: CollectorState["state"]) {
  switch (state) {
    case "inactive":
      return {
        title: "지정된 기기 없음",
        body: "아래 ‘알림 허용’에서 동의와 Android 접근을 확인하면 이 휴대폰을 지정해요.",
      };
    case "active_here":
      return {
        title: "이 기기가 지정되어 있어요",
        body: "현재 로그인 세션이 수집 기기로 지정되어 있어요. 로그아웃 후 다시 로그인하면 재지정이 필요해요.",
      };
    case "active_elsewhere":
      return {
        title: "다른 기기가 지정되어 있어요",
        body: "여러 기기에서 로그인할 수 있지만, 수집 기기는 계정당 한 대만 지정할 수 있어요.",
      };
  }
}

/** @param input 확인할 변경과 읽은 버전. 다른 기기에 미치는 영향을 선택 전에 알린다. */
export function collectorConfirmationCopy(input: CollectorChangeInput) {
  if (input.action === "deactivate")
    return {
      title: "기기 지정을 해제할까요?",
      body: "다른 기기가 지정되어 있어도 함께 해제돼요. 이미 저장한 거래는 삭제되지 않아요.",
      confirmLabel: "지정 해제 확인",
    };
  return input.replaceExisting
    ? {
        title: "이 기기로 변경할까요?",
        body: "다른 기기의 지정은 해제되고 현재 로그인한 기기로 바뀌어요. 기존 거래는 그대로 유지돼요.",
        confirmLabel: "기기 변경 확인",
      }
    : {
        title: "이 기기를 지정할까요?",
        body: "동의와 Android 접근이 확인된 현재 로그인 세션을 수집 기기로 지정해요. 실제 알림 수집은 아직 준비 중이에요.",
        confirmLabel: "기기 지정 확인",
      };
}

/** @param error 내부 예외. @param operation 읽기/변경 구분. 원문 대신 고정 복구 안내만 반환한다. */
export function collectorFailure(
  error: unknown,
  operation: "read" | "change",
): string {
  if (error instanceof ClientError) {
    if (error.code === "COLLECTOR_VERSION_CONFLICT")
      return "다른 요청에서 기기 지정이 변경됐어요. 현재 상태를 확인한 뒤 다시 선택해 주세요.";
    if (error.code === "COLLECTOR_REPLACE_REQUIRED")
      return "다른 기기의 지정을 바꾸려면 교체 확인이 필요해요. 현재 상태를 확인한 뒤 이 기기로 변경할지 선택해 주세요.";
    if (["AUTH_SESSION_EXPIRED", "SESSION_CHANGED"].includes(error.code))
      return "로그인 상태가 바뀌었어요. 현재 계정에서 다시 확인해 주세요.";
    if (error.status === 429)
      return "요청이 많아 처리 결과를 확인하지 못했어요. 잠시 기다린 뒤 다시 조회해 주세요.";
  }
  return operation === "change"
    ? "변경 요청의 결과를 확정할 수 없어요. 아래 현재 상태를 확인한 뒤 다시 선택해 주세요."
    : "기기 지정 상태를 불러오지 못했어요. 연결을 확인한 뒤 다시 조회해 주세요.";
}
