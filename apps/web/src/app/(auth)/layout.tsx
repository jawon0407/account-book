import type { ReactNode } from "react";

/**
 * 인증 페이지를 공통 main 영역에 배치한다. (auth)는 URL에 포함되지 않는 라우트 그룹이다.
 * @param props - children은 로그인·가입·비밀번호 등 현재 인증 페이지다.
 * @returns 인증 화면용 main 요소. 인증 여부를 검사하거나 이동시키지는 않는다.
 */
export default function AuthenticationLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <main className="auth-main">{children}</main>;
}
