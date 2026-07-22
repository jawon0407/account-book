import type { ReactNode } from "react";

type AuthStatusProps = Readonly<{
  kind: "pending" | "success" | "error";
  children: ReactNode;
}>;

/** Accessible authentication feedback whose meaning is explicit in text, not color alone. */
export function AuthStatus({ kind, children }: AuthStatusProps) {
  return (
    <div className={`auth-status auth-status-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="status-symbol" aria-hidden="true">{kind === "error" ? "!" : kind === "success" ? "✓" : "…"}</span>
      <span>{children}</span>
    </div>
  );
}
