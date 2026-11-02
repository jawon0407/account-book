// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TransactionSchema } from "@account-book/contracts";
import { TransactionTable } from "./transaction-table.js";

const id = "11111111-1111-4111-8111-111111111111", time = "2026-10-16T00:00:00Z";
const base = { id, accountId: null, categoryId: null, counterpartyName: null, transferId: null, kind: "expense", amountKrw: 19800, memo: null, occurredOn: "2026-10-16", version: 1, deletedAt: null, createdAt: time, updatedAt: time };
const noop = () => undefined;
afterEach(cleanup);
it("shows unassigned values and keeps amount visible", () => {
  render(<TransactionTable items={[TransactionSchema.parse(base)]} accounts={[]} categories={[]} onEdit={noop} onDelete={noop} />);
  for (const label of ["계좌 미지정", "미분류", "상대 미확인", "−19,800원"]) expect(screen.getByText(label)).toBeDefined();
});
it("distinguishes missing references from unassigned and renders long names as plain text", () => {
  const name = "<script>합성 상대</script>" + "가".repeat(170);
  const { container } = render(<TransactionTable items={[TransactionSchema.parse({ ...base, accountId: id, categoryId: id, counterpartyName: name })]} accounts={[]} categories={[]} onEdit={noop} onDelete={noop} />);
  expect(screen.getByText("계좌 정보 확인 필요")).toBeDefined();
  expect(screen.getByText("분류 정보 확인 필요")).toBeDefined();
  expect(screen.getByText(name)).toBeDefined();
  expect(container.querySelector("script")).toBeNull();
});
it("does not label a special-kind transaction as uncategorized", () => {
  render(<TransactionTable items={[TransactionSchema.parse({ ...base, accountId: id, kind: "opening_balance", direction: "asset" })]} accounts={[]} categories={[]} onEdit={noop} onDelete={noop} />);
  expect(screen.queryByText("미분류")).toBeNull();
  expect(screen.getByText("별도 관리")).toBeDefined();
});
it("shows the stored residence time and labels unknown times without inventing midnight", () => {
  render(<TransactionTable items={[TransactionSchema.parse({ ...base, time: { occurredOn: base.occurredOn, occurredAt: "2026-10-16T06:53:00.000Z", precision: "minute", source: "user", sourceTimeZone: "UTC", ledgerTimeZone: "Asia/Seoul" } })]} accounts={[]} categories={[]} onEdit={noop} onDelete={noop} />);
  expect(screen.getByText("15:53 · Asia/Seoul")).toBeDefined();
  cleanup();
  render(<TransactionTable items={[TransactionSchema.parse(base)]} accounts={[]} categories={[]} onEdit={noop} onDelete={noop} />);
  expect(screen.getByText("시간 미확인")).toBeDefined();
  expect(screen.queryByText(/00:00/)).toBeNull();
});
it("marks receipt-time estimates and keeps seconds only when known", () => {
  render(<TransactionTable items={[TransactionSchema.parse({ ...base, time: { occurredOn: base.occurredOn, occurredAt: "2026-10-16T06:53:12.000Z", precision: "second", source: "device_received", sourceTimeZone: null, ledgerTimeZone: "Asia/Seoul" } })]} accounts={[]} categories={[]} onEdit={noop} onDelete={noop} />);
  expect(screen.getByText("15:53:12 · Asia/Seoul · 수신 시각 추정")).toBeDefined();
});
