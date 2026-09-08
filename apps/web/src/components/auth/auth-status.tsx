import type { ReactNode } from "react";

type AuthStatusProps = Readonly<{
  kind: "pending" | "success" | "error";
  children: ReactNode;
}>;

/**
 * 인증 진행·성공·오류를 색상 외에 기호와 텍스트로도 안내한다.
 * 오류에는 alert, 나머지에는 status 역할을 사용해 보조기기에 상태를 알린다.
 * @param props - kind는 pending/success/error, children은 사용자에게 보일 안내 문구다.
 * @returns 접근성 역할이 포함된 상태 UI. 자체 요청이나 상태 변경은 없다.
 */
export function AuthStatus({ kind, children }: AuthStatusProps) {
  return (
    <div className={`auth-status auth-status-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="status-symbol" aria-hidden="true">{kind === "error" ? "!" : kind === "success" ? "✓" : "…"}</span>
      <span>{children}</span>
    </div>
  );
}
