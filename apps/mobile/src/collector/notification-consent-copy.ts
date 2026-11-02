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
  const canAccept =
    known && status !== "granted" && state.permission?.available === true;
  const canWithdraw = known && (status === "granted" || status === "outdated");
  const canOpenSettings =
    !busy &&
    state.permission?.available === true &&
    (status === "granted" || state.permission.accessGranted);
  const allowed =
    known &&
    status === "granted" &&
    state.permission?.available === true &&
    state.permission.accessGranted;
  const primaryAction: "allow" | "deny" | "settings" | "none" = busy
    ? "none"
    : allowed
      ? "deny"
      : canAccept || (status === "granted" && canOpenSettings)
        ? "allow"
        : canWithdraw
          ? "deny"
          : canOpenSettings
            ? "settings"
            : "none";
  return {
    busy,
    primaryAction,
    // 철회 후 OS 접근이 남아 있어도 재동의 없이 설정으로 돌아갈 수 있어야 한다.
    alternateAction: busy
      ? "none"
      : canWithdraw
        ? "deny"
        : canOpenSettings && state.permission?.accessGranted
          ? "settings"
          : "none",
    // 알려진 거절은 다른 쪽 조회 실패에 가리지 않는다. 양쪽 허용을 확인해야 허용이다.
    allowanceLabel: busy
      ? "확인 중"
      : (known && status !== "granted") ||
          (state.permission?.available && !state.permission.accessGranted)
        ? "허용되지 않음"
        : status === "granted" &&
            state.permission?.available &&
            state.permission.accessGranted
          ? "허용됨"
          : "확인 필요",
    consentLabel: status ? labels[status] : "확인 중 또는 확인 필요",
    canAccept,
    canWithdraw,
    canOpenSettings,
    permissionLabel: !state.permission
      ? "확인 중 또는 확인 필요"
      : !state.permission.available
        ? "새 개발 APK 설치 필요"
        : state.permission.accessGranted
          ? "허용됨"
          : "허용되지 않음",
  };
}
