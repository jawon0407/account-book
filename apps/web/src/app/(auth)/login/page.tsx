"use client";

import { useMutation } from "@tanstack/react-query";
import { AuthShell } from "../../../components/auth/auth-shell.js";
import { SignInForm } from "../../../components/auth/auth-form.js";
import { ProviderButtons } from "../../../components/auth/provider-buttons.js";
import { useOAuthAvailability } from "../../../queries/oauth-availability.js";
import { oauthStartMutationOptions, signInMutationOptions } from "../../../queries/auth.js";

/**
 * 이메일 로그인과 소셜 로그인 요청을 화면 컴포넌트에 연결한다.
 * @returns 인증 화면 JSX. 페이지 매개변수는 받지 않는다.
 * @remarks 성공 callback은 /app으로 이동한다. 장부 세션 경계가 신원을 다시 확인한 뒤 본인 계좌를 보여 준다.
 */
export default function LoginPage() {
  const signIn = useMutation(signInMutationOptions());
  const oauth = useMutation(oauthStartMutationOptions());
  const availability = useOAuthAvailability();
  // submit은 mutateAsync Promise를 그대로 폼에 전달해 로딩·오류 처리를 기다리게 한다. 소셜 로그인은 /app 복귀 경로를 사용한다.
  return (
    <AuthShell title="로그인" description="내 가계부를 안전하게 이어서 관리하세요." footer={<p>처음이신가요? <a href="/sign-up">새 계정 만들기</a></p>}>
      <SignInForm submit={(input) => signIn.mutateAsync(input)} onSuccess={() => window.location.assign("/app")} />
      <nav className="auth-links" aria-label="로그인 도움말"><a href="/forgot-password">비밀번호를 잊으셨나요?</a></nav>
      <ProviderButtons {...availability} start={(provider) => oauth.mutateAsync({ provider, returnPath: "/app" })} />
    </AuthShell>
  );
}
