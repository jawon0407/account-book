import type { ReactNode } from "react";

type AuthShellProps = Readonly<{
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}>;

/**
 * 인증 화면들의 제목·입력 영역·하단 링크·서비스 안내를 같은 틀에 배치한다.
 * 고정 제목 ID와 aria-labelledby를 연결하고 실제 배치는 공통 CSS에 맡긴다.
 * @param props - title은 제목, description은 설명, children은 폼/상태 UI, footer는 하단 링크다.
 * @returns 반응형 인증 화면 틀. 인증 처리나 데이터 저장 부작용은 없다.
 */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="auth-shell">
      <p className="auth-brand">Account Book</p>
      <section className="auth-surface" aria-labelledby="auth-heading">
        <header className="auth-heading">
          <h1 id="auth-heading">{title}</h1>
          <p>{description}</p>
        </header>
        {children}
        <footer className="auth-footer">{footer}</footer>
      </section>
      <aside className="auth-context" aria-label="서비스 안내">
        <div>
          <h2>돈의 흐름을 한눈에 이해하세요.</h2>
          <p>어느 기기에서든 기록은 빠르게, 재정 상태는 차분하고 명확하게 확인할 수 있어요.</p>
        </div>
        <p className="auth-security-note">인증 정보는 안전한 서버 세션으로만 처리합니다.</p>
      </aside>
    </div>
  );
}
