// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClientError } from "../../../lib/http/api-client.js";
import { buildApiError, type CreateTransactionInput } from "@account-book/contracts";
import { TransactionForm } from "./transaction-form.js";
const id = "11111111-1111-4111-8111-111111111111", timestamp = "2026-10-01T00:00:00Z";
const accounts = [{ id, name: "통장", kind: "bank" as const, version: 1, currentBalanceKrw: 0, archivedAt: null, createdAt: timestamp, updatedAt: timestamp }];
const categories = [{ id, name: "식비", kind: "expense" as const, sortOrder: 0, version: 1, archivedAt: null, createdAt: timestamp, updatedAt: timestamp }];
afterEach(cleanup);
it("freezes ambiguous input and retries exact body/key without duplicate clicks", async () => {
  const calls: CreateTransactionInput[] = [], saved = vi.fn();
  render(<TransactionForm accounts={accounts} categories={categories} onClose={() => undefined} onSaved={saved} onSave={async value => { calls.push(value); if (calls.length === 1) throw new Error("private"); }} />);
  fireEvent.change(screen.getByLabelText("금액 (원)"), { target: { value: "1200" } });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByRole("button", { name: "같은 내용으로 재시도" })).toBeDefined());
  expect(screen.getByLabelText("금액 (원)").closest("fieldset")?.disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).not.toContain("private");
  fireEvent.click(screen.getByRole("button", { name: "같은 내용으로 재시도" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
});
it("retains fields after a definite archived-parent rejection and permits correction", async () => {
  render(<TransactionForm accounts={accounts} categories={categories} onClose={() => undefined} onSaved={() => undefined} onSave={async () => { throw new ApiClientError(buildApiError({ code: "LEDGER_ACCOUNT_UNAVAILABLE", retryable: false })); }} />);
  fireEvent.change(screen.getByLabelText("금액 (원)"), { target: { value: "800" } });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  expect((screen.getByLabelText("금액 (원)") as HTMLInputElement).value).toBe("800");
  expect(screen.getByLabelText("금액 (원)").closest("fieldset")?.disabled).toBe(false);
});
it("validates amounts before submitting and guides missing prerequisites", () => {
  const save = vi.fn();
  const { rerender } = render(<TransactionForm accounts={accounts} categories={categories} onClose={() => undefined} onSaved={() => undefined} onSave={save} />);
  fireEvent.submit(screen.getByRole("form")); expect(save).not.toHaveBeenCalled();
  rerender(<TransactionForm accounts={[]} categories={[]} onClose={() => undefined} onSaved={() => undefined} onSave={save} />);
  expect(screen.getByRole("link", { name: "계좌 관리" })).toBeDefined();
  expect(screen.getByRole("link", { name: "카테고리 관리" })).toBeDefined();
});
