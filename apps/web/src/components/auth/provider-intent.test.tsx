// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderButtons } from "./provider-buttons.js";

afterEach(cleanup);

it("accepts only the signup handoff when rendered for signup", async () => {
  const navigate = vi.fn();
  const signupPath = "/api/auth/oauth/google/continue?returnPath=%2Fapp&intent=sign_up";
  const start = vi.fn().mockResolvedValueOnce({ authorizationPath: "/api/auth/oauth/google/continue?returnPath=%2Fapp" }).mockResolvedValueOnce({ authorizationPath: signupPath });
  render(<ProviderButtons intent="sign_up" enabledProviders={["google"]} start={start} navigate={navigate} />);
  await userEvent.click(screen.getByRole("button", { name: "Google로 계속" }));
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Google");
  await userEvent.click(screen.getByRole("button", { name: "Google로 계속" }));
  expect(navigate).toHaveBeenCalledExactlyOnceWith(signupPath);
});
