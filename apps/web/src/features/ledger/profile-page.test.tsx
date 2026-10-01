// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ProfilePage } from "./profile-page.js";

const api = vi.hoisted(() => ({ profile: { get: vi.fn(), update: vi.fn() } }));
vi.mock("./session.js", () => ({ useLedgerUser: () => "11111111-1111-4111-8111-111111111111", useLedgerApi: () => api }));
const profile = { id: "11111111-1111-4111-8111-111111111111", nickname: "이전 이름", avatarObjectKey: null, signupProvider: "email", role: "member", version: 3, createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z" };
const key = ["ledger", profile.id, "profile"];
afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** 프로필 HTTP 경계만 대체하며 실제 폼과 React Query를 실행한다. */
async function mount() {
  api.profile.get.mockResolvedValue(profile);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><ProfilePage /></QueryClientProvider>);
  await screen.findByLabelText("닉네임");
  return { client, view };
}

it("sends the version at edit start even if a later query changes the displayed record", async () => {
  const { client } = await mount();
  fireEvent.change(screen.getByLabelText("닉네임"), { target: { value: "내 수정" } });
  act(() => { client.setQueryData(key, { ...profile, version: 4 }); });
  api.profile.update.mockResolvedValue({ ...profile, nickname: "내 수정", version: 4 });
  fireEvent.click(screen.getByRole("button", { name: "저장하기" }));
  await waitFor(() => expect(api.profile.update).toHaveBeenCalled());
  expect(api.profile.update.mock.calls[0]![0]).toEqual({ nickname: "내 수정", expectedVersion: 3 });
  cleanup(); client.clear();
});

it("does not repopulate a cleared private cache when a write finishes after leaving", async () => {
  const { client, view } = await mount();
  let finish!: (value: typeof profile) => void;
  api.profile.update.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText("닉네임"), { target: { value: "나중 응답" } });
  fireEvent.click(screen.getByRole("button", { name: "저장하기" }));
  await waitFor(() => expect(api.profile.update).toHaveBeenCalled());
  view.unmount(); client.clear();
  await act(async () => { finish({ ...profile, nickname: "나중 응답" }); });
  expect(client.getQueryData(key)).toBeUndefined();
});
