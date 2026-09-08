"use client";

import {
  PasswordResetRequestInputSchema,
  PasswordUpdateInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
  type PasswordResetRequestInput,
  type PasswordUpdateInput,
  type SignInInput,
  type SignUpInput,
} from "@account-book/contracts";
import { useRef, useState, type FormEvent } from "react";
import type { z } from "zod";
import { AuthStatus } from "./auth-status.js";

type Feedback = Readonly<{ kind: "pending" | "success" | "error"; message: string }>;
type FieldErrors = Readonly<{ email?: string; password?: string }>;
type Credentials = SignInInput | SignUpInput;
type CredentialsFormProps<T extends Credentials> = Readonly<{ submit(input: T): Promise<unknown>; onSuccess?(): void }>;
type SingleFormProps<T> = Readonly<{ submit(input: T): Promise<unknown>; onSuccess?(): void }>;

const ERROR_MESSAGES = new Map<string, string>([
  ["AUTH_INVALID_CREDENTIALS", "이메일 또는 비밀번호를 확인해 주세요."],
  ["AUTH_EMAIL_VERIFICATION_REQUIRED", "메일함에서 이메일 인증을 먼저 완료해 주세요."],
  ["AUTH_SESSION_EXPIRED", "인증 시간이 만료되었어요. 다시 로그인해 주세요."],
  ["AUTH_SESSION_REFRESH_REQUIRED", "인증 상태를 갱신하지 못했어요. 다시 로그인해 주세요."],
  ["AUTH_CSRF_REJECTED", "보안 확인이 만료되었어요. 페이지를 새로고침한 뒤 다시 시도해 주세요."],
  ["AUTH_OAUTH_TRANSACTION_INVALID", "간편 로그인 요청이 만료되었어요. 다시 시작해 주세요."],
  ["AUTH_RATE_LIMITED", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."],
  ["AUTH_PROVIDER_UNAVAILABLE", "인증 서비스를 사용할 수 없어요. 잠시 후 다시 시도해 주세요."],
]);

/**
 * 알려진 공개 오류 코드를 고정 한국어 안내문으로 바꾼다.
 * @param error - 요청 실패 값. code가 문자열일 때만 허용 목록에서 찾는다.
 * @returns 사용자 안내문. 원본 message나 식별자는 노출하지 않고 미지의 값은 일반 실패로 표시한다.
 */
function safeErrorMessage(error: unknown): string {
  if (error === null || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") {
    return "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
  return ERROR_MESSAGES.get(error.code) ?? "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

/**
 * Zod 문제 경로의 첫 항목을 모아 이메일·비밀번호 오류만 화면 필드에 연결한다.
 * @param result - safeParse 실패 결과. 원본 오류 메시지는 UI에 직접 전달하지 않는다.
 * @returns email/password 선택 속성을 가진 고정 한국어 오류 모음. 외부 부작용은 없다.
 */
function validationErrors(result: z.ZodSafeParseError<unknown>): FieldErrors {
  const paths = new Set(result.error.issues.map((issue) => issue.path[0]));
  return {
    ...(paths.has("email") ? { email: "올바른 이메일 주소를 입력해 주세요." } : {}),
    ...(paths.has("password") ? { password: passwordValidationMessage(result) } : {}),
  };
}

/**
 * 비밀번호 최대 길이 초과 여부로 두 길이 안내 중 하나를 선택한다.
 * @param result - password 경로와 too_big 코드 여부를 확인할 검증 실패 결과다.
 * @returns 최대 1024자 또는 최소 12자 안내. 검증 자체를 수행하거나 상태를 바꾸지는 않는다.
 */
function passwordValidationMessage(result: z.ZodSafeParseError<unknown>): string {
  return result.error.issues.some((issue) => issue.path[0] === "password" && issue.code === "too_big")
    ? "비밀번호는 1024자 이하로 입력해 주세요."
    : "비밀번호는 12자 이상 입력해 주세요.";
}

/**
 * 로그인·가입에 공통인 이메일/비밀번호 폼과 로딩·성공·오류 상태를 관리한다.
 * 입력값은 제출 시 FormData로 읽고 스키마를 통과한 데이터만 submit에 넘긴다.
 * @param props - submit(input)은 요청 함수, onSuccess는 성공 callback, schema는 입력 계약이다.
 * autocomplete/kind는 입력 자동완성·ID를, buttonLabel/pendingLabel/pendingMessage/successMessage는 문구를 정한다.
 * @returns 공통 인증 폼. 제출 시 요청, 상태 변경, 오류 필드 포커스 이동이 발생한다.
 */
function CredentialsForm<T extends Credentials>({
  autocomplete,
  buttonLabel,
  kind,
  onSuccess,
  pendingLabel,
  pendingMessage,
  schema,
  submit,
  successMessage,
}: CredentialsFormProps<T> & Readonly<{
  autocomplete: "current-password" | "new-password";
  buttonLabel: string;
  kind: "sign-in" | "sign-up";
  pendingLabel: string;
  pendingMessage: string;
  schema: z.ZodType<T>;
  successMessage: string;
}>) {
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const isPending = feedback?.kind === "pending";

  /**
   * 기본 폼 이동을 막고 이메일/비밀번호 검증 후 주입된 요청을 한 번 실행한다.
   * @param event - 현재 폼을 가진 React 제출 이벤트. FormData에서 입력 두 개를 읽는다.
   * @returns 완료 Promise. 검증 실패는 필드 포커스로, 요청 실패는 안전한 안내문으로 처리한다.
   * @remarks 진행 중 제출은 무시한다. 성공 callback도 try 안에서 실행되어 그 오류 역시 안내문이 된다.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isPending) return;
    const data = new FormData(event.currentTarget);
    const parsed = schema.safeParse({ email: data.get("email"), password: data.get("password") });
    if (!parsed.success) {
      const nextErrors = validationErrors(parsed);
      setErrors(nextErrors);
      setFeedback({ kind: "error", message: nextErrors.email ?? nextErrors.password ?? "입력 내용을 확인해 주세요." });
      (nextErrors.email === undefined ? passwordRef : emailRef).current?.focus();
      return;
    }
    setErrors({});
    setFeedback({ kind: "pending", message: pendingMessage });
    try {
      await submit(parsed.data);
      setFeedback({ kind: "success", message: successMessage });
      onSuccess?.();
    } catch (error) {
      setFeedback({ kind: "error", message: safeErrorMessage(error) });
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
      <div className="field-group">
        <label htmlFor={`${kind}-email`}>이메일</label>
        <input
          aria-describedby={errors.email === undefined ? undefined : `${kind}-email-error`}
          aria-invalid={errors.email === undefined ? undefined : true}
          autoComplete="email"
          id={`${kind}-email`}
          name="email"
          onChange={() => setErrors((current) => current.password === undefined ? {} : { password: current.password })}
          ref={emailRef}
          type="email"
        />
        {errors.email === undefined ? null : <p className="field-error" id={`${kind}-email-error`}>{errors.email}</p>}
      </div>
      <div className="field-group">
        <label htmlFor={`${kind}-password`}>비밀번호</label>
        <input
          aria-describedby={errors.password === undefined ? undefined : `${kind}-password-error`}
          aria-invalid={errors.password === undefined ? undefined : true}
          autoComplete={autocomplete}
          id={`${kind}-password`}
          minLength={12}
          name="password"
          onChange={() => setErrors((current) => current.email === undefined ? {} : { email: current.email })}
          ref={passwordRef}
          type="password"
        />
        <p className="field-hint">12자 이상 입력해 주세요.</p>
        {errors.password === undefined ? null : <p className="field-error" id={`${kind}-password-error`}>{errors.password}</p>}
      </div>
      <button className="primary-button" disabled={isPending} type="submit">
        <span>{isPending ? pendingLabel : buttonLabel}</span>
        {isPending ? <span className="pending-indicator" aria-hidden="true">…</span> : null}
      </button>
      {feedback === null ? null : <AuthStatus kind={feedback.kind}>{feedback.message}</AuthStatus>}
    </form>
  );
}

/**
 * 공통 자격증명 폼에 로그인 계약과 문구·기존 비밀번호 자동완성을 지정한다.
 * @param props - submit({email, password})는 로그인 Promise, onSuccess는 선택 성공 callback이다.
 * @returns 로그인 폼. 요청·오류 처리는 CredentialsForm에 위임한다.
 */
export function SignInForm(props: CredentialsFormProps<SignInInput>) {
  return <CredentialsForm {...props} autocomplete="current-password" buttonLabel="로그인" kind="sign-in" pendingLabel="로그인 중" pendingMessage="안전하게 로그인하고 있어요." schema={SignInInputSchema} successMessage="로그인했어요." />;
}

/**
 * 공통 자격증명 폼에 가입 계약과 문구·새 비밀번호 자동완성을 지정한다.
 * @param props - submit({email, password})는 가입 Promise, onSuccess는 선택 성공 callback이다.
 * @returns 가입 폼. 요청·오류 처리는 CredentialsForm에 위임한다.
 */
export function SignUpForm(props: CredentialsFormProps<SignUpInput>) {
  return <CredentialsForm {...props} autocomplete="new-password" buttonLabel="가입하기" kind="sign-up" pendingLabel="가입 처리 중" pendingMessage="계정을 안전하게 만들고 있어요." schema={SignUpInputSchema} successMessage="가입 요청을 완료했어요." />;
}

/**
 * 비밀번호 복구 메일을 요청하는 이메일 입력 폼이다.
 * @param props - submit({email})은 요청 Promise, onSuccess는 요청 수락 후 실행할 선택 callback이다.
 * @returns 이메일 폼과 상태 안내. 계정 존재 여부와 무관한 성공 문구를 사용한다.
 */
export function PasswordResetRequestForm({ submit, onSuccess }: SingleFormProps<PasswordResetRequestInput>) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const isPending = feedback?.kind === "pending";

  /**
   * 이메일을 검증하고 복구 메일 요청을 실행한다.
   * @param event - 기본 이동을 막고 이메일 FormData를 읽을 폼 제출 이벤트다.
   * @returns 완료 Promise. 입력 실패 시 포커스를 옮기고 요청 실패 시 고정 안내를 설정한다.
   * @remarks 진행 중 중복 제출을 무시하며 성공 시 onSuccess를 호출한다.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isPending) return;
    const parsed = PasswordResetRequestInputSchema.safeParse({ email: new FormData(event.currentTarget).get("email") });
    if (!parsed.success) {
      const message = "올바른 이메일 주소를 입력해 주세요.";
      setError(message);
      setFeedback({ kind: "error", message });
      emailRef.current?.focus();
      return;
    }
    setError(null);
    setFeedback({ kind: "pending", message: "재설정 안내를 준비하고 있어요." });
    try {
      await submit(parsed.data);
      setFeedback({ kind: "success", message: "계정이 있다면 재설정 메일을 보냈어요. 메일함을 확인해 주세요." });
      onSuccess?.();
    } catch (caught) {
      setFeedback({ kind: "error", message: safeErrorMessage(caught) });
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
      <div className="field-group">
        <label htmlFor="reset-request-email">이메일</label>
        <input aria-describedby={error === null ? undefined : "reset-request-email-error"} aria-invalid={error === null ? undefined : true} autoComplete="email" id="reset-request-email" name="email" onChange={() => setError(null)} ref={emailRef} type="email" />
        {error === null ? null : <p className="field-error" id="reset-request-email-error">{error}</p>}
      </div>
      <button className="primary-button" disabled={isPending} type="submit"><span>{isPending ? "안내 준비 중" : "재설정 링크 받기"}</span>{isPending ? <span className="pending-indicator" aria-hidden="true">…</span> : null}</button>
      {feedback === null ? null : <AuthStatus kind={feedback.kind}>{feedback.message}</AuthStatus>}
    </form>
  );
}

/**
 * 복구 절차에서 새 비밀번호를 입력받아 제출하는 폼이다.
 * @param props - submit({password})는 변경 Promise, onSuccess는 성공 후 실행할 선택 callback이다.
 * @returns 새 비밀번호 입력과 상태 UI. 복구 권한 자체는 서버가 검증한다.
 */
export function PasswordUpdateForm({ submit, onSuccess }: SingleFormProps<PasswordUpdateInput>) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const isPending = feedback?.kind === "pending";

  /**
   * 새 비밀번호 계약을 검사하고 주입된 변경 요청을 실행한다.
   * @param event - 기본 이동을 막고 password FormData를 읽을 폼 제출 이벤트다.
   * @returns 완료 Promise. 길이 실패는 포커스·문구로, 요청 실패는 안전한 공개 안내로 처리한다.
   * @remarks 진행 중 재제출을 무시하며 성공 시 onSuccess를 호출한다.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isPending) return;
    const parsed = PasswordUpdateInputSchema.safeParse({ password: new FormData(event.currentTarget).get("password") });
    if (!parsed.success) {
      const message = passwordValidationMessage(parsed);
      setError(message);
      setFeedback({ kind: "error", message });
      passwordRef.current?.focus();
      return;
    }
    setError(null);
    setFeedback({ kind: "pending", message: "새 비밀번호를 안전하게 저장하고 있어요." });
    try {
      await submit(parsed.data);
      setFeedback({ kind: "success", message: "비밀번호를 변경했어요. 새 비밀번호로 로그인해 주세요." });
      onSuccess?.();
    } catch (caught) {
      setFeedback({ kind: "error", message: safeErrorMessage(caught) });
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
      <div className="field-group">
        <label htmlFor="new-password">새 비밀번호</label>
        <input aria-describedby={error === null ? undefined : "new-password-error"} aria-invalid={error === null ? undefined : true} autoComplete="new-password" id="new-password" minLength={12} name="password" onChange={() => setError(null)} ref={passwordRef} type="password" />
        <p className="field-hint">12자 이상 입력해 주세요.</p>
        {error === null ? null : <p className="field-error" id="new-password-error">{error}</p>}
      </div>
      <button className="primary-button" disabled={isPending} type="submit"><span>{isPending ? "변경 중" : "비밀번호 변경"}</span>{isPending ? <span className="pending-indicator" aria-hidden="true">…</span> : null}</button>
      {feedback === null ? null : <AuthStatus kind={feedback.kind}>{feedback.message}</AuthStatus>}
    </form>
  );
}
