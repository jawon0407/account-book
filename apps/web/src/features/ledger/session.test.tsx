// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { LedgerSession, useLedgerUser } from "./session.js";

const auth = vi.hoisted(() => ({ read: vi.fn(), signOut: vi.fn() }));
vi.mock("../../queries/auth.js", () => ({ currentUserQueryOptions: () => ({ queryKey: ["auth", "current-user"], queryFn: auth.read, retry: false }), signOutMutationOptions: () => ({ mutationFn: auth.signOut }) }));
vi.mock("next/navigation.js", () => ({ usePathname: () => "/app" }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("hides the old workspace throughout background identity revalidation", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  auth.read.mockResolvedValueOnce({ id: first });
  const root = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function PrivateContent() { return <p>private:{useLedgerUser()}</p>; }
  render(<QueryClientProvider client={root}><LedgerSession><PrivateContent /></LedgerSession></QueryClientProvider>);
  await screen.findByText(`private:${first}`);
  let finish!: (value: { id: string }) => void;
  auth.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  act(() => { void root.invalidateQueries({ queryKey: ["auth", "current-user"] }); });
  await waitFor(() => expect(screen.queryByText(`private:${first}`)).toBeNull());
  expect(screen.getByRole("status").textContent).toContain("로그인 상태");
  await act(async () => { finish({ id: second }); });
  await screen.findByText(`private:${second}`);
  expect(screen.queryByText(`private:${first}`)).toBeNull();
  cleanup(); root.clear();
});

it("does not offer navigation before the server logout finishes", async () => {
  auth.read.mockResolvedValueOnce({ id: "11111111-1111-4111-8111-111111111111" });
  let finish!: () => void;
  auth.signOut.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const root = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={root}><LedgerSession><p>private content</p></LedgerSession></QueryClientProvider>);
  await screen.findByText("private content");
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  await screen.findByRole("heading", { name: "로그아웃 중…" });
  expect(screen.queryByRole("link", { name: "로그인하기" })).toBeNull();
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  await act(async () => { finish(); });
  await screen.findByRole("heading", { name: "로그아웃했어요" });
  expect(screen.getByRole("link", { name: "로그인하기" })).toBeTruthy();
  cleanup(); root.clear();
});
