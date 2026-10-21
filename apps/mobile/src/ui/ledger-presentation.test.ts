import { expect, it } from "vitest";
import { transactionLabel, mergePage } from "./ledger-presentation";
import type { Transaction } from "@account-book/contracts";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  accountId: null,
  categoryId: null,
  kind: "expense",
  amountKrw: 20000,
  occurredOn: "2026-10-16",
  memo: null,
  counterpartyName: "한일마트",
  transferId: null,
  version: 1,
  deletedAt: null,
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
} satisfies Transaction;
it("shows counterpart rather than invented category and marks unassigned", () => {
  expect(transactionLabel(row)).toEqual({
    title: "한일마트",
    amount: "−20,000원",
    detail: "2026-10-16 · 지출",
    unassigned: "계좌 미지정 · 미분류",
  });
});
it("does not confuse missing counterparty with empty transaction", () => {
  expect(
    transactionLabel({ ...row, counterpartyName: null, kind: "income" }),
  ).toMatchObject({
    title: "거래 상대 미확인",
    amount: "+20,000원",
    detail: "2026-10-16 · 수입",
  });
});
it("formats maximum safe contract amount without floating point precision loss", () => {
  expect(transactionLabel({ ...row, amountKrw: 9007199254740991 }).amount).toBe(
    "−9,007,199,254,740,991원",
  );
});
it("deduplicates cursor overlap without sorting by invented timestamps", () => {
  expect(
    mergePage(
      [row],
      [row, { ...row, id: "22222222-2222-4222-8222-222222222222" }],
    ),
  ).toHaveLength(2);
});
