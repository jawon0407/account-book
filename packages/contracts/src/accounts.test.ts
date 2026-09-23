import { describe, expect, it } from "vitest";
import {
  AccountListQuerySchema,
  AccountSchema,
  ArchiveAccountInputSchema,
  CreateAccountInputSchema,
  SetOpeningBalanceInputSchema,
  UpdateAccountInputSchema,
} from "./accounts.js";

const id = "123e4567-e89b-42d3-a456-426614174000";
const idempotencyKey = "223e4567-e89b-42d3-a456-426614174000";
const timestamp = "2026-08-26T12:34:56.000Z";

describe("account commands", () => {
  it("accepts minimal create, update, archive, and opening balance inputs", () => {
    expect(CreateAccountInputSchema.parse({ idempotencyKey, kind: "bank", name: "  급여 통장  " })).toEqual({
      idempotencyKey,
      kind: "bank",
      name: "급여 통장",
    });
    expect(UpdateAccountInputSchema.parse({ expectedVersion: 1, name: "생활비" })).toEqual({
      expectedVersion: 1,
      name: "생활비",
    });
    expect(ArchiveAccountInputSchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
    expect(SetOpeningBalanceInputSchema.parse({
      accountId: id,
      amountKrw: 500_000,
      direction: "asset",
      idempotencyKey,
      occurredOn: "2026-08-26",
    })).toMatchObject({ accountId: id, amountKrw: 500_000, direction: "asset" });
  });

  it("rejects unknown ownership fields, empty patches, zero amounts, and invalid kinds", () => {
    expect(() => CreateAccountInputSchema.parse({ idempotencyKey, kind: "crypto", name: "코인" })).toThrow();
    expect(() => CreateAccountInputSchema.parse({ idempotencyKey, kind: "cash", name: "현금", userId: id })).toThrow();
    expect(() => UpdateAccountInputSchema.parse({ expectedVersion: 1 })).toThrow();
    expect(() => SetOpeningBalanceInputSchema.parse({
      accountId: id,
      amountKrw: 0,
      direction: "asset",
      idempotencyKey,
      occurredOn: "2026-08-26",
    })).toThrow();
  });
});

describe("account responses", () => {
  it("accepts a strict server-owned account response", () => {
    expect(AccountSchema.parse({
      archivedAt: null,
      createdAt: timestamp,
      currentBalanceKrw: -30_000,
      id,
      kind: "card",
      name: "생활 카드",
      updatedAt: timestamp,
      version: 3,
    })).toMatchObject({ currentBalanceKrw: -30_000, id, version: 3 });
  });

  it("rejects response secrets and validates includeArchived as a boolean", () => {
    expect(() => AccountListQuerySchema.parse({ includeArchived: "true" })).toThrow();
    expect(() => AccountSchema.parse({
      archivedAt: null,
      createdAt: timestamp,
      currentBalanceKrw: 0,
      id,
      kind: "cash",
      name: "현금",
      token: "secret",
      updatedAt: timestamp,
      version: 1,
    })).toThrow();
  });
});
