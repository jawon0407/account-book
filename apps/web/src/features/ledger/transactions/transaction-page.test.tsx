// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { TransactionPage } from "./transaction-page.js";
vi.mock("../session.js", () => ({
  useLedgerUser: () => "11111111-1111-4111-8111-111111111111",
  useLedgerApi: () => ({ accounts: { list: async () => ({ items: [] }) }, categories: { list: async () => ({ items: [] }) } }),
}));
vi.mock("./api.js", () => ({ createTransactionsApi: () => ({ list: async () => ({ items: [], nextCursor: null }), create: vi.fn(), update: vi.fn(), remove: vi.fn() }) }));
afterEach(cleanup);
it("offers PC viewing and editing without any create action or misleading empty-state advice", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><TransactionPage /></QueryClientProvider>);
  await screen.findByRole("heading", { name: "조회된 거래가 없어요" });
  expect(screen.queryByRole("button", { name: /거래 추가/ })).toBeNull();
  expect(screen.getByText(/새 거래는 Android 앱에서 기록하고 PC에서는 조회·편집/)).toBeDefined();
  expect(screen.getByText(/Android 앱 설치 파일은 아직 제공되지 않아요/)).toBeDefined();
  expect(screen.queryByText(/첫 수입·지출을 기록해/)).toBeNull();
  client.clear();
});
