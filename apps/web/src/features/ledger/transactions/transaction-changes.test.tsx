// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { buildApiError, type Transaction } from "@account-book/contracts";
import { ApiClientError } from "../../../lib/http/api-client.js";
import { TransactionEditForm } from "./transaction-edit-form.js";
import { TransactionDeleteForm } from "./transaction-delete-form.js";
const id = "11111111-1111-4111-8111-111111111111", timestamp = "2026-10-01T00:00:00Z";
const accounts = [{ id, name: "통장", kind: "bank" as const, version: 1, currentBalanceKrw: 0, archivedAt: null, createdAt: timestamp, updatedAt: timestamp }];
const categories = [{ id, name: "식비", kind: "expense" as const, sortOrder: 0, version: 1, archivedAt: null, createdAt: timestamp, updatedAt: timestamp }];
const row: Transaction = { id, accountId: id, categoryId: id, transferId: null, kind: "expense", amountKrw: 100, memo: "원본", occurredOn: "2026-10-01", version: 3, deletedAt: null, createdAt: timestamp, updatedAt: timestamp };
const noop = () => undefined;
afterEach(cleanup);
it("edits using the original version and explicit null for cleared memo", async () => {
  const save = vi.fn(async () => undefined), saved = vi.fn();
  render(<TransactionEditForm row={row} accounts={accounts} categories={categories} onSave={save} onSaved={saved} onClose={noop} />);
  fireEvent.change(screen.getByLabelText("금액 (원)"), { target: { value: "200" } });
  fireEvent.change(screen.getByLabelText("메모 (선택)"), { target: { value: "" } });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3, amountKrw: 200, memo: null }));
});
it.each(["LEDGER_VERSION_CONFLICT", "LEDGER_SERVICE_UNAVAILABLE"] as const)("locks %s without losing input or retrying", async code => {
  const save = vi.fn(async () => { throw new ApiClientError(buildApiError({ code, retryable: false })); });
  render(<TransactionEditForm row={row} accounts={accounts} categories={categories} onSave={save} onSaved={noop} onClose={noop} />);
  fireEvent.change(screen.getByLabelText("메모 (선택)"), { target: { value: "입력 보존" } });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  expect((screen.getByLabelText("메모 (선택)") as HTMLTextAreaElement).value).toBe("입력 보존");
  expect((screen.getByRole("button", { name: "저장하기" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByRole("form")); expect(save).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "닫고 목록 확인" })).toBeDefined();
});
it("keeps existing archived choices visible and validates amount before transport", () => {
  const save = vi.fn();
  render(<TransactionEditForm row={row} accounts={accounts.map(x => ({ ...x, archivedAt: timestamp }))} categories={categories.map(x => ({ ...x, archivedAt: timestamp }))} onSave={save} onSaved={noop} onClose={noop} />);
  expect(screen.getByRole("option", { name: "통장 (보관됨)" })).toBeDefined();
  fireEvent.change(screen.getByLabelText("금액 (원)"), { target: { value: "1.5" } });
  fireEvent.submit(screen.getByRole("form")); expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeDefined();
});
it("requires explicit delete confirmation and blocks duplicate clicks and ambiguous retry", async () => {
  let fail!: (reason: Error) => void;
  const remove = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; })), saved = vi.fn();
  render(<TransactionDeleteForm row={row} accountName="통장" onDelete={remove} onDeleted={saved} onClose={noop} />);
  expect(remove).not.toHaveBeenCalled(); expect(screen.getByText(/목록과 잔액에서 제외/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));
  fireEvent.click(screen.getByRole("button", { name: "삭제 중…" }));
  expect(remove).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith({ expectedVersion: 3 });
  fail(new Error("private failure"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  expect(screen.getByRole("alert").textContent).not.toContain("private failure");
  expect((screen.getByRole("button", { name: "삭제하기" }) as HTMLButtonElement).disabled).toBe(true);
  expect(saved).not.toHaveBeenCalled();
});
