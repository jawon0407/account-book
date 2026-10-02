// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LoginPage from "./login/page.js";
import SignUpPage from "./sign-up/page.js";

const boundary = vi.hoisted(() => ({ search: "", post: vi.fn(), get: vi.fn() }));
vi.mock("next/navigation.js", () => ({ useSearchParams: () => new URLSearchParams(boundary.search) }));
vi.mock("../../queries/oauth-availability.js", () => ({ useOAuthAvailability: () => ({ enabledProviders: ["google"], availability: "ready" }) }));
vi.mock("../../lib/http/api-client.js", async (importOriginal) => ({ ...await importOriginal<typeof import("../../lib/http/api-client.js")>(), apiClient: { post: boundary.post, get: boundary.get } }));

beforeEach(() => {
  boundary.search = "";
  boundary.post.mockReset().mockReturnValue({ json: async () => { throw new Error("offline fixture"); } });
  boundary.get.mockReset().mockReturnValue({ json: async () => ({ csrfToken: "csrf-token" }) });
});
afterEach(cleanup);

it("submits social signup intent from the signup page", async () => {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><SignUpPage /></QueryClientProvider>);
  await userEvent.click(screen.getByRole("button", { name: "Google로 계속" }));
  await waitFor(() => expect(boundary.post).toHaveBeenCalledWith("auth/oauth/google/start", { json: { returnPath: "/app", intent: "sign_up" }, headers: { "X-CSRF-Token": "csrf-token" } }));
  client.clear();
});

it.each(["notice=social-signup", "notice=password-reset", "notice=secret-provider-detail"])("shows only allowlisted login guidance for %s", (search) => {
  boundary.search = search;
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><LoginPage /></QueryClientProvider>);
  const notice = screen.queryByText(/소셜 계정을 확인했어요/u);
  if (search === "notice=social-signup") expect(notice).not.toBeNull();
  else expect(notice).toBeNull();
  if (search === "notice=password-reset") expect(screen.getByText(/1~2분/u)).not.toBeNull();
  expect(document.body.textContent).not.toContain("secret-provider-detail");
  client.clear();
});
