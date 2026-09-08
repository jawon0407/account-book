// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Credentials = Readonly<{ email: string; password: string }>;
type EmailInput = Readonly<{ email: string }>;
type PasswordInput = Readonly<{ password: string }>;
type Provider = "google" | "kakao" | "naver";

type CredentialsFormProps = Readonly<{
  /** @param input 폼이 검증한 이메일·비밀번호. 테스트 대역에 전달한다. @returns 제출 완료 Promise. */
  submit(input: Credentials): Promise<unknown>;
  /** 제출 성공 후 실행할 테스트 콜백. 인수·반환값은 없다. */
  onSuccess?(): void;
}>;
type EmailFormProps = Readonly<{
  /** @param input 재설정 메일 요청용 이메일. @returns 요청 완료 Promise. */
  submit(input: EmailInput): Promise<unknown>;
  /** 메일 요청 수락 후 호출하는 선택 콜백. 계정 존재를 뜻하지 않는다. */
  onSuccess?(): void;
}>;
type PasswordFormProps = Readonly<{
  /** @param input 폼이 검증한 새 비밀번호. @returns 변경 요청 완료 Promise. */
  submit(input: PasswordInput): Promise<unknown>;
  /** 변경 성공 후 호출하는 선택 콜백. 인수·반환값은 없다. */
  onSuccess?(): void;
}>;
type ProviderButtonsProps = Readonly<{
  /** @param provider 선택한 허용 공급자 이름. @returns BFF의 같은 출처 계속 경로 Promise. */
  start(provider: Provider): Promise<Readonly<{ authorizationPath: string }>>;
  /** @param path 검증된 같은 출처 계속 경로. 테스트에서는 실제 이동 대신 호출을 기록한다. */
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

/**
 * OKLCH 토큰을 선형 RGB 휘도로 변환해 흰색과의 대비를 계산한다.
 * @param css 테스트가 읽은 CSS 원문. 이 함수가 파일을 읽지는 않는다.
 * @param token `--`를 제외한 색상 변수 이름. 숫자 OKLCH 선언을 찾는다.
 * @returns 흰색 대비 비율. 모든 배경·상태의 접근성을 보장하는 값은 아니다.
 * @throws 해당 토큰 선언이 없으면 테스트를 실패시키는 오류.
 */
function contrastWithWhite(css: string, token: string): number {
  const match = css.match(new RegExp(`--${token}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`, "u"));
  if (match === null) throw new Error(`Missing OKLCH token: ${token}`);
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = Number(match[3]) * Math.PI / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const red = Math.min(1, Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s));
  const green = Math.min(1, Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s));
  const blue = Math.min(1, Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s));
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return 1.05 / (luminance + 0.05);
}

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

  it("maps overlong passwords to fixed corrective copy before any mutation", async () => {
    expect(SignInForm).toBeTypeOf("function");
    expect(PasswordUpdateForm).toBeTypeOf("function");
    if (SignInForm === undefined || PasswordUpdateForm === undefined) return;
    const signIn = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SignInForm submit={signIn} />);
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "person@example.test" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "p".repeat(1025) } });
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(signIn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("비밀번호"));
    expect(screen.getByRole("alert").textContent).toContain("비밀번호는 1024자 이하로 입력해 주세요");
    cleanup();

    const update = vi.fn(async () => undefined);
    render(<PasswordUpdateForm submit={update} />);
    fireEvent.change(screen.getByLabelText("새 비밀번호"), { target: { value: "p".repeat(1025) } });
    await user.click(screen.getByRole("button", { name: "비밀번호 변경" }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("비밀번호는 1024자 이하로 입력해 주세요");
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

  it("puts the primary form surface before explanatory context in mobile reading order", () => {
    expect(AuthShell).toBeTypeOf("function");
    if (AuthShell === undefined) return;
    render(
      <AuthShell title="로그인" description="계속하려면 로그인하세요." footer={<a href="/sign-up">새 계정 만들기</a>}>
        <p>로그인 양식</p>
      </AuthShell>,
    );
    const surface = screen.getByRole("heading", { level: 1, name: "로그인" }).closest("section");
    const context = screen.getByRole("complementary", { name: "서비스 안내" });
    expect(surface).not.toBeNull();
    expect(surface!.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("identifies the authentication surface once before requesting credentials", () => {
    expect(AuthShell).toBeTypeOf("function");
    if (AuthShell === undefined) return;
    render(
      <AuthShell title="로그인" description="계속하려면 로그인하세요." footer={<a href="/sign-up">새 계정 만들기</a>}>
        <p>로그인 양식</p>
      </AuthShell>,
    );
    const brand = screen.getByText("Account Book");
    const heading = screen.getByRole("heading", { level: 1, name: "로그인" });
    const context = screen.getByRole("complementary", { name: "서비스 안내" });
    expect(screen.getAllByText("Account Book")).toHaveLength(1);
    expect(brand.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(heading.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

  it("keeps control boundaries at WCAG non-text contrast", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(contrastWithWhite(css, "line")).toBeGreaterThanOrEqual(3);
  });

  it("keeps 768px single-column and starts desktop layout at 769px", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain("@media (min-width: 48.0625rem)");
    expect(css).not.toContain("@media (min-width: 48rem)");
  });

  it("uses one non-blocking 180ms ease-out pending transition", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.pending-indicator\s*\{[^}]*animation:\s*auth-pending 180ms ease-out 1/isu);
    expect(css).not.toMatch(/\.spinner|720ms|infinite/iu);
  });

  it("keeps Korean words intact with a long-token overflow fallback", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain("word-break: keep-all");
    expect(css).toContain("overflow-wrap: anywhere");
  });

  it("uses 4pt-compatible component spacing values", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).not.toMatch(/0\.(?:375|625|6875)rem/iu);
  });

  it("lifts only the form surface instead of the composite shell", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const shell = css.match(/\.auth-shell\s*\{([^}]*)\}/isu)?.[1] ?? "";
    const surface = css.match(/^\.auth-surface\s*\{([^}]*)\}/imu)?.[1] ?? "";
    expect(shell).not.toContain("box-shadow");
    expect(surface).toContain("box-shadow");
  });

  it("provides global tabular numerals for stable financial values", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const body = css.match(/body\s*\{([^}]*)\}/isu)?.[1] ?? "";
    expect(body).toContain("font-variant-numeric: tabular-nums");
  });
});
