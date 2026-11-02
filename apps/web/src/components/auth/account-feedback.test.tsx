// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PasswordResetRequestForm, SignUpForm, PasswordUpdateForm } from "./auth-form.js";
import InvalidRecoveryLinkPage from "../../app/(auth)/forgot-password/invalid-link/page.js";

afterEach(cleanup);

it("shows an absent account as an error without a false delivery success", async () => {
  render(<PasswordResetRequestForm submit={async () => { throw { code: "AUTH_ACCOUNT_NOT_FOUND" }; }} />);
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "absent@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "재설정 링크 받기" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("존재하지 않는 계정"));
  expect(screen.queryByText(/메일을 보냈어요/u)).toBeNull();
});

it("keeps duplicate signup on the form and offers the login route", async () => {
  const onSuccess = vi.fn();
  render(<SignUpForm submit={async () => { throw { code: "AUTH_ACCOUNT_EXISTS" }; }} onSuccess={onSuccess} />);
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "member@example.test" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "fixture-password-123!" } });
  fireEvent.click(screen.getByRole("button", { name: "가입하기" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("이미 가입된 이메일"));
  expect(screen.getByRole("link", { name: "기존 계정으로 로그인" }).getAttribute("href")).toBe("/login");
  expect(onSuccess).not.toHaveBeenCalled();
});

it("explains invalid recovery context without telling a logged-out user to log in", async () => {
  render(<PasswordUpdateForm submit={async () => { throw { code: "AUTH_OAUTH_TRANSACTION_INVALID" }; }} />);
  fireEvent.change(screen.getByLabelText("새 비밀번호"), { target: { value: "fixture-password-123!" } });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("재설정 링크"));
});

it("offers anonymous recovery re-entry instead of the protected ledger", () => {
  render(<InvalidRecoveryLinkPage />);
  expect(screen.getByRole("link", { name: "재설정 링크 다시 받기" }).getAttribute("href")).toBe("/forgot-password");
  expect(screen.queryByRole("link", { name: "내 장부" })).toBeNull();
});
