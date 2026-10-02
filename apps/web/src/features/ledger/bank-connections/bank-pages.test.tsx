// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BankStartPage } from "./start-page.js";
import { BankResultPage } from "./result-page.js";

const id = "123e4567-e89b-42d3-a456-426614174001";
const port = vi.hoisted(() => ({ start: vi.fn(), complete: vi.fn(), status: vi.fn() }));
vi.mock("../session.js", () => ({ useLedgerUser: () => "123e4567-e89b-42d3-a456-426614174001" }));
vi.mock("./api.js", () => ({ createBankApi: () => port }));
/** @param child 실제 화면. 요청 캐시는 각 테스트별로 격리한다. */
function show(child: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{child}</QueryClientProvider>); }
beforeEach(() => { vi.resetAllMocks(); port.status.mockResolvedValue({ requestId: id, status: "awaiting_completion" }); });
afterEach(cleanup);

it("clearly disables unconfigured bank linking without pretending manual accounts are bank connections", () => {
  show(<BankStartPage />);
  expect((screen.getByRole("button", { name: "은행 연결 준비 중" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/자동 수집은 아직/)).toBeDefined(); expect(port.start).not.toHaveBeenCalled();
});
it("rejects invalid return queries without reading bank state", () => {
  show(<BankResultPage requestId={null} />);
  expect(screen.getByRole("alert").textContent).toMatch(/올바르지/); expect(port.status).not.toHaveBeenCalled();
});
it("does not complete on mount; asks for one explicit confirmation", async () => {
  port.complete.mockResolvedValue({ requestId: id, status: "connected" }); show(<BankResultPage requestId={id} />);
  const button = await screen.findByRole("button", { name: "연결 확인" }); expect(port.complete).not.toHaveBeenCalled();
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(screen.getByText("연결 인증을 완료했어요")).toBeDefined());
  expect(port.complete).toHaveBeenCalledOnce(); expect(port.complete).toHaveBeenCalledWith(id);
  expect(screen.getByText(/잔액·입출금 조회는/)).toBeDefined();
});
it("offers only status refresh after an uncertain completion, never automatic resubmission", async () => {
  port.complete.mockRejectedValue(new Error("private token")); show(<BankResultPage requestId={id} />);
  fireEvent.click(await screen.findByRole("button", { name: "연결 확인" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  expect(screen.getByRole("alert").textContent).not.toContain("private token");
  expect(screen.queryByRole("button", { name: "연결 확인" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "상태 새로고침" }));
  await waitFor(() => expect(port.status).toHaveBeenCalledTimes(2)); expect(port.complete).toHaveBeenCalledOnce();
});
it.each([
  ["awaiting_callback", "은행 인증을 기다리고 있어요"], ["exchanging", "연결을 확인하고 있어요"],
  ["cancelled", "은행 연결이 취소됐어요"], ["expired", "연결 시간이 지났어요"], ["failed", "은행 연결을 완료하지 못했어요"],
])("explains safe next steps for %s", async (status, title) => {
  port.status.mockResolvedValue({ requestId: id, status }); show(<BankResultPage requestId={id} />);
  await screen.findByText(title); expect(port.complete).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "연결 확인" })).toBeNull();
});
