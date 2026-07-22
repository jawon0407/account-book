// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Credentials = Readonly<{ email: string; password: string }>;
type EmailInput = Readonly<{ email: string }>;
type PasswordInput = Readonly<{ password: string }>;
type Provider = "google" | "kakao" | "naver";

type CredentialsFormProps = Readonly<{
  submit(input: Credentials): Promise<unknown>;
  onSuccess?(): void;
}>;
type EmailFormProps = Readonly<{
  submit(input: EmailInput): Promise<unknown>;
  onSuccess?(): void;
}>;
type PasswordFormProps = Readonly<{
  submit(input: PasswordInput): Promise<unknown>;
  onSuccess?(): void;
}>;
type ProviderButtonsProps = Readonly<{
  start(provider: Provider): Promise<Readonly<{ authorizationPath: string }>>;
  navigate?(path: string): void;
}>;
type AuthShellProps = Readonly<{
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}>;

const forms = await import("./auth-form.js").catch(() => ({} as Record<string, unknown>));
const providers = await import("./provider-buttons.js").catch(() => ({} as Record<string, unknown>));
const shells = await import("./auth-shell.js").catch(() => ({} as Record<string, unknown>));
const SignInForm = forms.SignInForm as ComponentType<CredentialsFormProps> | undefined;
const SignUpForm = forms.SignUpForm as ComponentType<CredentialsFormProps> | undefined;
const PasswordResetRequestForm = forms.PasswordResetRequestForm as ComponentType<EmailFormProps> | undefined;
const PasswordUpdateForm = forms.PasswordUpdateForm as ComponentType<PasswordFormProps> | undefined;
const ProviderButtons = providers.ProviderButtons as ComponentType<ProviderButtonsProps> | undefined;
const AuthShell = shells.AuthShell as ComponentType<AuthShellProps> | undefined;

afterEach(cleanup);

describe("authentication forms", () => {
  it("keeps the form accessible while sign-in is pending", async () => {
    expect(SignInForm).toBeTypeOf("function");
    if (SignInForm === undefined) return;
    const user = userEvent.setup();
    render(<SignInForm submit={() => new Promise(() => undefined)} />);

    const email = screen.getByLabelText("이메일") as HTMLInputElement;
    const password = screen.getByLabelText("비밀번호") as HTMLInputElement;
    expect(email.autocomplete).toBe("email");
    expect(password.autocomplete).toBe("current-password");
    await user.type(email, "person@example.test");
    await user.type(password, "correct-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect((screen.getByRole("button", { name: "로그인 중" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("안전하게 로그인하고 있어요");
  });

  it("blocks invalid credentials before submission and focuses the first invalid field", async () => {
    expect(SignInForm).toBeTypeOf("function");
    if (SignInForm === undefined) return;
    const submit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SignInForm submit={submit} />);

    await user.type(screen.getByLabelText("이메일"), "invalid");
    await user.type(screen.getByLabelText("비밀번호"), "short");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    const email = screen.getByLabelText("이메일") as HTMLInputElement;
    expect(submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe("sign-in-email-error");
    expect(screen.getByRole("alert").textContent).toContain("올바른 이메일 주소를 입력해 주세요");
  });

  it("maps an allowlisted API code without rendering raw details", async () => {
    expect(SignInForm).toBeTypeOf("function");
    if (SignInForm === undefined) return;
    const user = userEvent.setup();
    const submit = vi.fn(async () => Promise.reject({
      code: "AUTH_INVALID_CREDENTIALS",
      message: "provider raw message",
      requestId: "request-secret",
      token: "token-secret",
    }));
    render(<SignInForm submit={submit} />);

    await user.type(screen.getByLabelText("이메일"), "person@example.test");
    await user.type(screen.getByLabelText("비밀번호"), "correct-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(screen.getByRole("alert").textContent).toContain("이메일 또는 비밀번호를 확인해 주세요");
    expect(document.body.textContent).not.toMatch(/provider raw message|request-secret|token-secret/u);
  });

  it("uses the correct password autocomplete modes and reports successful auth steps", async () => {
    expect(SignUpForm).toBeTypeOf("function");
    expect(PasswordResetRequestForm).toBeTypeOf("function");
    expect(PasswordUpdateForm).toBeTypeOf("function");
    if (SignUpForm === undefined || PasswordResetRequestForm === undefined || PasswordUpdateForm === undefined) return;
    const user = userEvent.setup();
    const signedUp = vi.fn();
    const { unmount } = render(<SignUpForm submit={async () => undefined} onSuccess={signedUp} />);
    expect((screen.getByLabelText("비밀번호") as HTMLInputElement).autocomplete).toBe("new-password");
    await user.type(screen.getByLabelText("이메일"), "person@example.test");
    await user.type(screen.getByLabelText("비밀번호"), "correct-password");
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    expect(signedUp).toHaveBeenCalledOnce();
    unmount();

    render(<PasswordResetRequestForm submit={async () => undefined} />);
    await user.type(screen.getByLabelText("이메일"), "person@example.test");
    await user.click(screen.getByRole("button", { name: "재설정 링크 받기" }));
    expect(screen.getByRole("status").textContent).toContain("메일함을 확인해 주세요");
    cleanup();

    render(<PasswordUpdateForm submit={async () => undefined} />);
    expect((screen.getByLabelText("새 비밀번호") as HTMLInputElement).autocomplete).toBe("new-password");
    await user.type(screen.getByLabelText("새 비밀번호"), "new-safe-password");
    await user.click(screen.getByRole("button", { name: "비밀번호 변경" }));
    expect(screen.getByRole("status").textContent).toContain("비밀번호를 변경했어요");
  });
});

describe("provider and shell interactions", () => {
  it("blocks duplicate provider actions while navigating only to the returned same-origin path", async () => {
    expect(ProviderButtons).toBeTypeOf("function");
    if (ProviderButtons === undefined) return;
    let resolveStart: ((value: Readonly<{ authorizationPath: string }>) => void) | undefined;
    const start = vi.fn(() => new Promise<Readonly<{ authorizationPath: string }>>((resolve) => { resolveStart = resolve; }));
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<ProviderButtons start={start} navigate={navigate} />);

    await user.click(screen.getByRole("button", { name: "Google로 계속" }));
    expect((screen.getByRole("button", { name: "Google로 이동 중" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Kakao로 계속" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Naver로 계속" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Google 인증 화면으로 이동하고 있어요");
    expect(start).toHaveBeenCalledWith("google");

    await act(async () => resolveStart?.({ authorizationPath: "/api/auth/oauth/google/continue?returnPath=%2Fapp" }));
    expect(navigate).toHaveBeenCalledWith("/api/auth/oauth/google/continue?returnPath=%2Fapp");
  });

  it("makes alternate auth flows keyboard reachable from the page heading", async () => {
    expect(AuthShell).toBeTypeOf("function");
    if (AuthShell === undefined) return;
    const user = userEvent.setup();
    render(
      <AuthShell title="로그인" description="계속하려면 로그인하세요." footer={<a href="/sign-up">새 계정 만들기</a>}>
        <p>로그인 양식</p>
      </AuthShell>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "로그인" })).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "새 계정 만들기" }));
    expect(screen.getByRole("link", { name: "새 계정 만들기" }).getAttribute("href")).toBe("/sign-up");
  });

  it("includes the exact reduced-motion safety override", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("scroll-behavior: auto !important");
    expect(css).toContain("animation-duration: 1ms !important");
    expect(css).toContain("animation-iteration-count: 1 !important");
    expect(css).toContain("transition-duration: 1ms !important");
  });

  it("keeps footer authentication links at the minimum touch target height", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.auth-footer a\s*\{[^}]*min-height:\s*44px/isu);
  });
});
