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

/** Maps only a fixed public error code; raw messages and identifiers are deliberately ignored. */
function safeErrorMessage(error: unknown): string {
  if (error === null || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") {
    return "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
  return ERROR_MESSAGES.get(error.code) ?? "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

function validationErrors(result: z.ZodSafeParseError<unknown>): FieldErrors {
  const paths = new Set(result.error.issues.map((issue) => issue.path[0]));
  return {
    ...(paths.has("email") ? { email: "올바른 이메일 주소를 입력해 주세요." } : {}),
    ...(paths.has("password") ? { password: passwordValidationMessage(result) } : {}),
  };
}

function passwordValidationMessage(result: z.ZodSafeParseError<unknown>): string {
  return result.error.issues.some((issue) => issue.path[0] === "password" && issue.code === "too_big")
    ? "비밀번호는 1024자 이하로 입력해 주세요."
    : "비밀번호는 12자 이상 입력해 주세요.";
}

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

export function SignInForm(props: CredentialsFormProps<SignInInput>) {
  return <CredentialsForm {...props} autocomplete="current-password" buttonLabel="로그인" kind="sign-in" pendingLabel="로그인 중" pendingMessage="안전하게 로그인하고 있어요." schema={SignInInputSchema} successMessage="로그인했어요." />;
}

export function SignUpForm(props: CredentialsFormProps<SignUpInput>) {
  return <CredentialsForm {...props} autocomplete="new-password" buttonLabel="가입하기" kind="sign-up" pendingLabel="가입 처리 중" pendingMessage="계정을 안전하게 만들고 있어요." schema={SignUpInputSchema} successMessage="가입 요청을 완료했어요." />;
}

export function PasswordResetRequestForm({ submit, onSuccess }: SingleFormProps<PasswordResetRequestInput>) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const isPending = feedback?.kind === "pending";

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

export function PasswordUpdateForm({ submit, onSuccess }: SingleFormProps<PasswordUpdateInput>) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const isPending = feedback?.kind === "pending";

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
