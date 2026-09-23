"use client";

import { useMutation } from "@tanstack/react-query";
import { AuthShell } from "../../../components/auth/auth-shell.js";
import { SignUpForm } from "../../../components/auth/auth-form.js";
import { ProviderButtons } from "../../../components/auth/provider-buttons.js";
import { oauthStartMutationOptions, signUpMutationOptions } from "../../../queries/auth.js";

/**
 * 가입·소셜 로그인 mutation을 공통 인증 화면에 연결한다.
 * @returns 인증 화면 JSX. 페이지 매개변수는 받지 않는다.
 * @remarks 이메일 가입 수락 시 /verify-email로 이동한다. 소셜 로그인은 /app 복귀 경로를 사용한다.
 */
export default function SignUpPage() {
  const signUp = useMutation(signUpMutationOptions());
  const oauth = useMutation(oauthStartMutationOptions());
  // submit callback은 입력을 가입 mutation으로 전달하며 onSuccess는 인증 안내 페이지로 이동한다.
  return (
    <AuthShell title="계정 만들기" description="이메일로 시작하거나 익숙한 계정으로 안전하게 가입하세요." footer={<p>이미 계정이 있나요? <a href="/login">로그인으로 돌아가기</a></p>}>
      <SignUpForm submit={(input) => signUp.mutateAsync(input)} onSuccess={() => window.location.assign("/verify-email")} />
      <ProviderButtons start={(provider) => oauth.mutateAsync({ provider, returnPath: "/app" })} />
    </AuthShell>
  );
}
