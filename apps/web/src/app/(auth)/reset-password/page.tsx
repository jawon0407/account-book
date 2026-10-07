"use client";

import { useMutation } from "@tanstack/react-query";
import { AuthShell } from "../../../components/auth/auth-shell.js";
import { PasswordUpdateForm } from "../../../components/auth/auth-form.js";
import { passwordUpdateMutationOptions } from "../../../queries/auth.js";

/**
 * 비밀번호 갱신 mutation과 새 비밀번호 폼을 연결한다.
 * @returns 인증 화면 JSX. 페이지 매개변수는 받지 않는다.
 * @remarks 성공 callback은 복구 후 대기를 설명하는 고정 로그인 안내 경로로 이동한다. 복구 문맥 검증은 BFF가 담당한다.
 */
export default function ResetPasswordPage() {
  const update = useMutation(passwordUpdateMutationOptions());
  // submit callback은 검증된 새 비밀번호를 변경 mutation으로 전달하고 성공 시 로그인으로 이동한다.
  return (
    <AuthShell title="새 비밀번호 설정" description="다른 곳에서 사용하지 않는 12자 이상의 비밀번호를 입력하세요." footer={<p><a href="/login">로그인으로 돌아가기</a></p>}>
      <PasswordUpdateForm submit={(input) => update.mutateAsync(input)} onSuccess={() => window.location.assign("/login?notice=password-reset")} />
    </AuthShell>
  );
}
