import { AuthShell } from "../../../components/auth/auth-shell.js";
import { AuthStatus } from "../../../components/auth/auth-status.js";

export default function VerifyEmailPage() {
  return (
    <AuthShell title="이메일을 확인해 주세요" description="가입을 마치려면 받은 편지함에서 인증 링크를 열어 주세요." footer={<p><a href="/login">로그인으로 이동</a></p>}>
      <AuthStatus kind="success">인증 메일을 보냈어요. 메일이 보이지 않으면 스팸함도 확인해 주세요.</AuthStatus>
    </AuthShell>
  );
}
