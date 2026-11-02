import { ClientError, errorMessage } from "../api/client-error";
import { ManualInputError } from "../ledger/manual-input-error";

/** 원문/예외 내용을 출력하지 않고 입력 정정 또는 재조회 방법만 안내한다. */
export function manualError(error: unknown): string {
  const code =
    error instanceof ManualInputError || error instanceof ClientError
      ? error.code
      : "";
  const messages: Record<string, string> = {
    AMOUNT_INVALID:
      "금액은 1원 이상의 정수로 입력해 주세요. 소수점이나 지수 표기는 사용할 수 없어요.",
    DATE_INVALID: "실제로 존재하는 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.",
    CLOCK_INVALID: "시각은 24시간제 HH:mm 형식으로 입력해 주세요.",
    TIME_INVALID: "날짜·시각·시간대 조합을 확인해 주세요.",
    TIME_DOES_NOT_EXIST:
      "여름시간 전환으로 존재하지 않는 시각이에요. 거래 시각을 다시 확인해 주세요.",
    TIME_CHOICE_REQUIRED:
      "같은 시각이 두 번 존재해요. 아래에서 실제 거래 시점을 선택해 주세요.",
    TIME_ZONE_INVALID: "유효한 지역 시간대를 입력해 주세요. 예: Asia/Seoul",
    TIME_PRECISION_UNSUPPORTED:
      "이 과거 시각은 분 단위로 정확히 변환할 수 없어요. 시각을 비우고 날짜만 기록해 주세요.",
    RESIDENCE_REQUIRED:
      "시각을 입력하려면 장부의 거주 기준을 먼저 설정해 주세요. 날짜만 기록할 수도 있어요.",
    ACCOUNT_UNAVAILABLE:
      "선택한 계좌를 사용할 수 없어요. 목록을 새로 불러오거나 미지정으로 변경해 주세요.",
    CATEGORY_UNAVAILABLE:
      "선택한 분류를 사용할 수 없어요. 목록을 새로 불러오거나 미분류로 변경해 주세요.",
    LEDGER_ACCOUNT_UNAVAILABLE:
      "계좌가 변경됐어요. 선택 목록을 새로 불러온 뒤 다시 확인해 주세요.",
    LEDGER_CATEGORY_UNAVAILABLE:
      "분류가 변경됐어요. 선택 목록을 새로 불러온 뒤 다시 확인해 주세요.",
    LEDGER_TIME_SETUP_REQUIRED:
      "거주 기준을 먼저 설정하거나 시각을 비워 주세요.",
    LEDGER_TIME_REVIEW_REQUIRED:
      "거래 당시의 장부 거주 시간대를 확인해 주세요. 이사 전 거래라면 당시 기준을 입력하면 현지 날짜·시각은 유지한 채 다시 확인할 수 있어요.",
    LEDGER_TIME_CHANGE_REQUIRED:
      "거주 기준 변경 경계에 있는 시각이에요. 거래 날짜와 시각을 다시 확인해 주세요.",
    LEDGER_VERSION_CONFLICT:
      "다른 기기에서 설정이 변경됐어요. 최신 설정을 불러왔으니 다시 확인해 주세요.",
    INPUT_INVALID: "입력 길이와 형식을 확인해 주세요.",
  };
  return messages[code] ?? errorMessage(error);
}
