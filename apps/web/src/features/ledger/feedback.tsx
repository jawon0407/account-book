import { ApiClientError } from "../../lib/http/api-client.js";
import styles from "./ledger.module.css";

/** @param error 원본 예외를 출력하지 않고 오류 코드에 맞는 한국어 복구 행동을 안내한다. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "저장 결과를 확인하지 못했어요. 입력을 유지한 채 다시 시도해 주세요.";
  switch (error.code) {
    case "LEDGER_VERSION_CONFLICT": case "PROFILE_VERSION_CONFLICT": return "다른 화면에서 정보가 변경됐어요. 닫은 뒤 최신 목록을 불러와 다시 수정해 주세요.";
    case "LEDGER_IDEMPOTENCY_CONFLICT": return "이 요청은 이미 다른 내용으로 처리됐어요. 목록을 확인한 뒤 다시 시작해 주세요.";
    case "LEDGER_ACCOUNT_UNAVAILABLE": case "LEDGER_CATEGORY_UNAVAILABLE": case "LEDGER_NOT_FOUND": return "이 항목을 사용할 수 없어요. 최신 목록을 확인해 주세요.";
    case "AUTH_CSRF_REJECTED": return "요청을 확인할 수 없어요. 화면을 새로고침한 뒤 다시 시도해 주세요.";
    case "AUTH_RATE_LIMITED": return "요청이 많아요. 잠시 후 다시 시도해 주세요.";
    case "LEDGER_VALIDATION_FAILED": case "PROFILE_VALIDATION_FAILED": return "입력 내용을 확인해 주세요.";
    default: return "서버 응답을 확인하지 못했어요. 입력을 유지한 채 다시 시도해 주세요.";
  }
}

/** @param error 공개 오류. 오래된 버전/다른 생성 의도를 같은 폼으로 강제 재전송하지 않는다. */
export function needsReload(error: unknown): boolean {
  return error instanceof ApiClientError && ["LEDGER_VERSION_CONFLICT", "PROFILE_VERSION_CONFLICT", "LEDGER_IDEMPOTENCY_CONFLICT"].includes(error.code);
}

/** @param props message는 이미 정리한 문구, error는 alert 여부. */
export function Feedback({ message, error = false }: Readonly<{ message: string; error?: boolean }>) {
  return <p className={error ? styles.error : styles.notice} role={error ? "alert" : "status"}>{message}</p>;
}

/** @param label 현재 읽는 정보 이름. 데이터 도착 전 형태와 읽기 상태만 보여 준다. */
export function Loading({ label = "정보를 불러오는 중…" }: Readonly<{ label?: string }>) {
  return <div className={styles.loading} role="status"><span>{label}</span><div className={styles.skeleton} aria-hidden="true" /><div className={styles.skeleton} aria-hidden="true" /></div>;
}
