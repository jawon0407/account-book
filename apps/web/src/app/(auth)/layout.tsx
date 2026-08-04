import type { ReactNode } from "react";

export default function AuthenticationLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <main className="auth-main">{children}</main>;
}
