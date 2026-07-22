"use client";

import { useMutation } from "@tanstack/react-query";
import { AuthShell } from "../../../components/auth/auth-shell.js";
import { PasswordResetRequestForm } from "../../../components/auth/auth-form.js";
import { passwordResetMutationOptions } from "../../../queries/auth.js";

export default function ForgotPasswordPage() {
  const reset = useMutation(passwordResetMutationOptions());
  return (
    <AuthShell title="비밀번호 재설정" description="가입한 이메일을 입력하면 다음 단계를 안내해 드려요." footer={<p><a href="/login">로그인으로 돌아가기</a></p>}>
      <PasswordResetRequestForm submit={(input) => reset.mutateAsync(input)} />
    </AuthShell>
  );
}
