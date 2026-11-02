import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildManualInput, type ManualDraft } from "./manual-input";
import type { Account, Category } from "@account-book/contracts";

const stamp = "2026-10-16T00:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";
const account: Account = {
  id,
  kind: "bank",
  name: "생활비",
  currentBalanceKrw: 0,
  archivedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
  version: 1,
};
const category: Category = {
  id,
  kind: "expense",
  name: "운동",
  sortOrder: 0,
  archivedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
  version: 1,
};
const draft: ManualDraft = {
  type: "expense",
  amount: "20,000",
  date: "2026-10-16",
  clock: "",
  sourceTimeZone: "Asia/Seoul",
  timeChoice: null,
  accountId: null,
  categoryId: null,
  counterpartyName: "",
  memo: "",
};
const context = {
  accounts: [account],
  categories: [category],
  ledgerTimeZone: "Asia/Seoul",
};

describe("manual transaction normalization", () => {
  it("preserves the UTC instant while using an explicitly confirmed historical residence", () => {
    const input = buildManualInput(
      {
        ...draft,
        date: "2026-10-01",
        clock: "09:00",
        sourceTimeZone: "Asia/Seoul",
        historicalLedgerTimeZone: "Asia/Seoul",
      },
      { ...context, ledgerTimeZone: "America/Los_Angeles" },
    );
    expect(input.occurredOn).toBe("2026-10-01");
    expect(input.time?.occurredAt).toBe("2026-10-01T00:00:00.000Z");
    expect(input).not.toHaveProperty("historicalLedgerTimeZone");
    expect(input).toEqual(JSON.parse(readFileSync(new URL("../../../../tests/fixtures/mobile-historical-transaction.json", import.meta.url), "utf8")));
  });
  it("allows date-only unassigned/unclassified entries without manufacturing time", () => {
    expect(
      buildManualInput(draft, { ...context, ledgerTimeZone: null }),
    ).toEqual({
      type: "expense",
      amountKrw: 20000,
      occurredOn: "2026-10-16",
      accountId: null,
      categoryId: null,
      counterpartyName: null,
    });
  });
  it("keeps recipient and memo separate from category", () => {
    expect(
      buildManualInput(
        {
          ...draft,
          accountId: id,
          categoryId: id,
          counterpartyName: "  거래상대  ",
          memo: "  라켓 구입  ",
        },
        context,
      ),
    ).toMatchObject({
      accountId: id,
      categoryId: id,
      counterpartyName: "거래상대",
      memo: "라켓 구입",
    });
  });
  it.each(["0", "-1", "1.5", "1e3", "2,00", "1,,000", "9007199254740992", ""])(
    "rejects unsafe money %s",
    (amount) => {
      expect(() => buildManualInput({ ...draft, amount }, context)).toThrow(
        "AMOUNT_INVALID",
      );
    },
  );
  it("supports the exact maximum safe integer without rounding", () => {
    expect(
      buildManualInput({ ...draft, amount: "9,007,199,254,740,991" }, context)
        .amountKrw,
    ).toBe(9007199254740991);
  });
  it("rejects missing/archived accounts and categories of a different direction", () => {
    expect(() =>
      buildManualInput(
        { ...draft, accountId: id },
        { ...context, accounts: [] },
      ),
    ).toThrow("ACCOUNT_UNAVAILABLE");
    expect(() =>
      buildManualInput(
        { ...draft, accountId: id },
        { ...context, accounts: [{ ...account, archivedAt: stamp }] },
      ),
    ).toThrow("ACCOUNT_UNAVAILABLE");
    expect(() =>
      buildManualInput({ ...draft, type: "income", categoryId: id }, context),
    ).toThrow("CATEGORY_UNAVAILABLE");
  });
  it("requires residence selection for an exact clock entry", () => {
    expect(() =>
      buildManualInput(
        { ...draft, clock: "15:53" },
        { ...context, ledgerTimeZone: null },
      ),
    ).toThrow("RESIDENCE_REQUIRED");
  });
  it("uses residence calendar date when recording a travel-local clock", () => {
    expect(
      buildManualInput(
        {
          ...draft,
          date: "2026-09-15",
          clock: "23:30",
          sourceTimeZone: "America/New_York",
        },
        context,
      ),
    ).toMatchObject({
      occurredOn: "2026-09-16",
      time: {
        occurredAt: "2026-09-16T03:30:00.000Z",
        precision: "minute",
        sourceTimeZone: "America/New_York",
      },
    });
  });
  it("does not silently choose one DST overlap", () => {
    expect(() =>
      buildManualInput(
        {
          ...draft,
          date: "2026-11-01",
          clock: "01:30",
          sourceTimeZone: "America/New_York",
        },
        context,
      ),
    ).toThrow("TIME_CHOICE_REQUIRED");
  });
});
