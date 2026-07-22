"use client";

import { useMutation } from "@tanstack/react-query";
import { AuthShell } from "../../../components/auth/auth-shell.js";
import { SignInForm } from "../../../components/auth/auth-form.js";
import { ProviderButtons } from "../../../components/auth/provider-buttons.js";
import { oauthStartMutationOptions, signInMutationOptions } from "../../../queries/auth.js";

export default function LoginPage() {
  const signIn = useMutation(signInMutationOptions());
  const oauth = useMutation(oauthStartMutationOptions());
  return (
    <AuthShell title="로그인" description="내 가계부를 안전하게 이어서 관리하세요." footer={<p>처음이신가요? <a href="/sign-up">새 계정 만들기</a></p>}>
      <SignInForm submit={(input) => signIn.mutateAsync(input)} onSuccess={() => window.location.assign("/app")} />
      <nav className="auth-links" aria-label="로그인 도움말"><a href="/forgot-password">비밀번호를 잊으셨나요?</a></nav>
      <ProviderButtons start={(provider) => oauth.mutateAsync({ provider, returnPath: "/app" })} />
    </AuthShell>
  );
}
