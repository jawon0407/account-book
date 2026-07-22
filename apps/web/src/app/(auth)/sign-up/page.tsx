"use client";

import { useMutation } from "@tanstack/react-query";
import { AuthShell } from "../../../components/auth/auth-shell.js";
import { SignUpForm } from "../../../components/auth/auth-form.js";
import { ProviderButtons } from "../../../components/auth/provider-buttons.js";
import { oauthStartMutationOptions, signUpMutationOptions } from "../../../queries/auth.js";

export default function SignUpPage() {
  const signUp = useMutation(signUpMutationOptions());
  const oauth = useMutation(oauthStartMutationOptions());
  return (
    <AuthShell title="계정 만들기" description="이메일로 시작하거나 익숙한 계정으로 안전하게 가입하세요." footer={<p>이미 계정이 있나요? <a href="/login">로그인으로 돌아가기</a></p>}>
      <SignUpForm submit={(input) => signUp.mutateAsync(input)} onSuccess={() => window.location.assign("/verify-email")} />
      <ProviderButtons start={(provider) => oauth.mutateAsync({ provider, returnPath: "/app" })} />
    </AuthShell>
  );
}
