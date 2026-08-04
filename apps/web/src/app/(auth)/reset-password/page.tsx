"use client";

import { useMutation } from "@tanstack/react-query";
import { AuthShell } from "../../../components/auth/auth-shell.js";
import { PasswordUpdateForm } from "../../../components/auth/auth-form.js";
import { passwordUpdateMutationOptions } from "../../../queries/auth.js";

export default function ResetPasswordPage() {
  const update = useMutation(passwordUpdateMutationOptions());
  return (
    <AuthShell title="새 비밀번호 설정" description="다른 곳에서 사용하지 않는 12자 이상의 비밀번호를 입력하세요." footer={<p><a href="/login">로그인으로 돌아가기</a></p>}>
      <PasswordUpdateForm submit={(input) => update.mutateAsync(input)} onSuccess={() => window.location.assign("/login")} />
    </AuthShell>
  );
}
