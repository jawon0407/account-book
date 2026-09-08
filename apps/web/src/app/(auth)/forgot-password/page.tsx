"use client";

import { useMutation } from "@tanstack/react-query";
import { AuthShell } from "../../../components/auth/auth-shell.js";
import { PasswordResetRequestForm } from "../../../components/auth/auth-form.js";
import { passwordResetMutationOptions } from "../../../queries/auth.js";

/**
 * 재설정 메일 요청 mutation과 이메일 폼을 연결한다.
 * @returns 인증 화면 JSX. 페이지 매개변수는 받지 않는다.
 * @remarks 요청 실패·성공 문구는 PasswordResetRequestForm이 표시한다. 이 페이지는 직접 이동하지 않는다.
 */
export default function ForgotPasswordPage() {
  const reset = useMutation(passwordResetMutationOptions());
  // submit callback은 mutateAsync Promise를 폼에 돌려주어 요청 결과에 맞춰 안내를 갱신하게 한다.
  return (
    <AuthShell title="비밀번호 재설정" description="가입한 이메일을 입력하면 다음 단계를 안내해 드려요." footer={<p><a href="/login">로그인으로 돌아가기</a></p>}>
      <PasswordResetRequestForm submit={(input) => reset.mutateAsync(input)} />
    </AuthShell>
  );
}
