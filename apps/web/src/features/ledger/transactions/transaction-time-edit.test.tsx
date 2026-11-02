// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TransactionSchema } from "@account-book/contracts";
import { TransactionEditForm } from "./transaction-edit-form.js";

const at = "2026-10-16T06:53:00.000Z";
const row = TransactionSchema.parse({ id: "11111111-1111-4111-8111-111111111111", accountId: null, categoryId: null, transferId: null,
  kind: "expense", amountKrw: 20000, occurredOn: "2026-10-16", memo: null, version: 1, deletedAt: null, createdAt: at, updatedAt: at,
  time: { occurredOn: "2026-10-16", occurredAt: at, precision: "minute", source: "user", sourceTimeZone: null, ledgerTimeZone: "Asia/Seoul" } });
const noop = () => undefined;
afterEach(cleanup);
it("preserves recorded time when changing only memo", async () => {
  const save = vi.fn<(value: unknown) => Promise<void>>(async () => undefined);
  render(<TransactionEditForm row={row} accounts={[]} categories={[]} onSave={save} onSaved={noop} onClose={noop} />);
  expect((screen.getByLabelText("거래일") as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("메모 (선택)"), { target: { value: "메모만" } });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[0]).not.toHaveProperty("time");
});
it("requires an explicit opt-in to clear time and correct its calendar date", async () => {
  const save = vi.fn<(value: unknown) => Promise<void>>(async () => undefined);
  render(<TransactionEditForm row={row} accounts={[]} categories={[]} onSave={save} onSaved={noop} onClose={noop} />);
  fireEvent.click(screen.getByLabelText("기록된 시각을 지우고 날짜만 지정"));
  expect((screen.getByLabelText("거래일") as HTMLInputElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("거래일"), { target: { value: "2026-10-17" } });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ occurredOn: "2026-10-17", time: null, expectedVersion: 1 })));
});
it("reverting the clear choice also restores the original date", () => {
  render(<TransactionEditForm row={row} accounts={[]} categories={[]} onSave={async () => undefined} onSaved={noop} onClose={noop} />);
  fireEvent.click(screen.getByLabelText("기록된 시각을 지우고 날짜만 지정"));
  fireEvent.change(screen.getByLabelText("거래일"), { target: { value: "2026-10-17" } });
  fireEvent.click(screen.getByLabelText("기록된 시각을 지우고 날짜만 지정"));
  expect((screen.getByLabelText("거래일") as HTMLInputElement).value).toBe("2026-10-16");
});
