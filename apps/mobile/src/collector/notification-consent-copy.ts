import type { AccessState } from "./notification-access";

/** @param state 서버 조회 결과와 OS 조회 결과. 표시와 행동 정책을 함께 파생하여 화면/모델의 조건 차이를 방지한다. */
export function consentPresentation(state: AccessState) {
  const busy = ["idle", "loading", "saving"].includes(state.phase);
  const known = state.phase === "ready" && state.consent !== null;
  const status = known ? state.consent!.state : null;
  const labels = {
    not_granted: "동의하지 않음",
    granted: "서버 저장 완료",
    withdrawn: "철회됨",
    outdated: "고지 변경 — 다시 확인 필요",
  };
  return {
    busy,
    consentLabel: status ? labels[status] : "확인 중 또는 확인 필요",
    canAccept:
      known && status !== "granted" && state.permission?.available === true,
    canWithdraw: known && (status === "granted" || status === "outdated"),
    canOpenSettings:
      !busy &&
      state.permission?.available === true &&
      (status === "granted" || state.permission.accessGranted),
    permissionLabel: !state.permission
      ? "확인 중 또는 확인 필요"
      : !state.permission.available
        ? "새 개발 APK 설치 필요"
        : state.permission.accessGranted
          ? "허용됨"
          : "허용되지 않음",
  };
}
