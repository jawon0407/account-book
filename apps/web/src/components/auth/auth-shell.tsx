import type { ReactNode } from "react";

type AuthShellProps = Readonly<{
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}>;

/** Shared authentication frame with one stable heading and a responsive context panel. */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="auth-shell">
      <aside className="auth-context" aria-label="서비스 안내">
        <p className="auth-brand">Account Book</p>
        <div>
          <h2>돈의 흐름을 한눈에 이해하세요.</h2>
          <p>어느 기기에서든 기록은 빠르게, 재정 상태는 차분하고 명확하게 확인할 수 있어요.</p>
        </div>
        <p className="auth-security-note">인증 정보는 안전한 서버 세션으로만 처리합니다.</p>
      </aside>
      <section className="auth-surface" aria-labelledby="auth-heading">
        <header className="auth-heading">
          <h1 id="auth-heading">{title}</h1>
          <p>{description}</p>
        </header>
        {children}
        <footer className="auth-footer">{footer}</footer>
      </section>
    </div>
  );
}
