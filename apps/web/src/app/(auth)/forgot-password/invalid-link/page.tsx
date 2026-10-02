import { AuthShell } from "../../../../components/auth/auth-shell.js";
import { AuthStatus } from "../../../../components/auth/auth-status.js";

/** 복구 링크 실패를 비로그인 상태에서 설명한다. URL 코드·이메일·토큰은 읽거나 출력하지 않는다. */
export default function InvalidRecoveryLinkPage() {
  return (
    <AuthShell title="재설정 링크를 확인해 주세요" description="로그인하지 않아도 비밀번호를 다시 설정할 수 있어요." footer={<p><a href="/login">로그인으로 돌아가기</a></p>}>
      <AuthStatus kind="error">링크를 확인하지 못했어요. 만료되었거나 이미 사용된 링크일 수 있어요. 요청한 브라우저에서 가장 최근 메일의 링크를 열거나 다시 요청해 주세요.</AuthStatus>
      <nav className="auth-links" aria-label="비밀번호 복구 도움말"><a href="/forgot-password">재설정 링크 다시 받기</a></nav>
    </AuthShell>
  );
}
