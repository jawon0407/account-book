import { AuthShell } from "../../../components/auth/auth-shell.js";
import { AuthStatus } from "../../../components/auth/auth-status.js";

/**
 * 가입 후 받은 편지함을 확인하도록 안내하는 정적 페이지다.
 * @returns 인증 화면 JSX. 페이지 매개변수는 받지 않는다.
 * @remarks 이 페이지 자체는 메일 발송이나 인증 상태 조회를 하지 않는다. 실제 인증 링크는 BFF callback이 처리한다.
 */
export default function VerifyEmailPage() {
  return (
    <AuthShell title="이메일을 확인해 주세요" description="가입을 마치려면 받은 편지함에서 인증 링크를 열어 주세요." footer={<p><a href="/login">로그인으로 이동</a></p>}>
      <AuthStatus kind="success">인증 메일을 보냈어요. 메일이 보이지 않으면 스팸함도 확인해 주세요.</AuthStatus>
    </AuthShell>
  );
}
