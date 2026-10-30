import { expect, it } from "vitest";
import { CreateTransactionInputSchema, UpdateTransactionInputSchema, TransactionSchema } from "./transactions.js";
import { ProfileSchema, UpdateProfileInputSchema } from "./profiles.js";

const id = "11111111-1111-4111-8111-111111111111", at = "2026-10-16T06:53:00.000Z";
const manual = { occurredAt: at, precision: "minute", sourceTimeZone: "Asia/Seoul" };
const create = { type: "expense", amountKrw: 20000, occurredOn: "2026-10-16", idempotencyKey: id };
const row = { id, accountId: null, categoryId: null, transferId: null, kind: "expense", amountKrw: 20000,
  occurredOn: "2026-10-16", memo: null, version: 1, deletedAt: null, createdAt: at, updatedAt: at };
const snapshot = { ...manual, occurredOn: "2026-10-16", source: "user", ledgerTimeZone: "Asia/Seoul" };

it("accepts an explicit manual instant while preserving date-only request compatibility", () => {
  expect(CreateTransactionInputSchema.parse({ ...create, time: manual }).time).toEqual(manual);
  expect(CreateTransactionInputSchema.parse(create)).not.toHaveProperty("time");
});
it.each([{ source: "notification" }, { ledgerTimeZone: "UTC" }, { occurredAt: "2026-10-16T06:53:01.000Z" }, { sourceTimeZone: "+09:00" }])("rejects invented source/zone or precision %#", extra => {
  expect(CreateTransactionInputSchema.safeParse({ ...create, time: { ...manual, ...extra } }).success).toBe(false);
});
it("requires a date with explicit time correction and accepts a deliberate time clear", () => {
  expect(UpdateTransactionInputSchema.parse({ expectedVersion: 1, occurredOn: "2026-10-17", time: null }).time).toBeNull();
  expect(UpdateTransactionInputSchema.parse({ expectedVersion: 1, occurredOn: "2026-10-16", time: manual }).time).toEqual(manual);
  for (const time of [null, manual]) expect(UpdateTransactionInputSchema.safeParse({ expectedVersion: 1, time }).success).toBe(false);
});
it("accepts stored time without recalculating historical calendar dates", () => {
  // A later tzdb update must not rewrite or reject the already-stored calendar snapshot on reads.
  expect(TransactionSchema.parse({ ...row, time: { ...snapshot, occurredAt: "2026-10-15T00:00:00.000Z" } }).time?.occurredOn).toBe(row.occurredOn);
  expect(TransactionSchema.parse(row)).not.toHaveProperty("time");
});
it("rejects contradictory snapshot shape and top-level calendar date", () => {
  for (const time of [{ ...snapshot, occurredOn: "2026-10-17" }, { ...snapshot, occurredAt: null }, { ...snapshot, ledgerTimeZone: null }])
    expect(TransactionSchema.safeParse({ ...row, time }).success).toBe(false);
});
it("accepts a timezone-only profile change without allowing client revision/effective clock", () => {
  expect(UpdateProfileInputSchema.parse({ expectedVersion: 1, ledgerTimeZone: "Asia/Seoul" })).toEqual({ expectedVersion: 1, ledgerTimeZone: "Asia/Seoul" });
  for (const extra of [{ ledgerTimeZone: null }, { effectiveFrom: at }, { revision: 2 }])
    expect(UpdateProfileInputSchema.safeParse({ expectedVersion: 1, ledgerTimeZone: "UTC", ...extra }).success).toBe(false);
});
it("returns a nullable current residence setting without leaking history", () => {
  const profile = { id, nickname: null, avatarObjectKey: null, signupProvider: "email", role: "member", version: 1, createdAt: at, updatedAt: at };
  expect(ProfileSchema.parse({ ...profile, ledgerTimeZone: null }).ledgerTimeZone).toBeNull();
  expect(ProfileSchema.parse({ ...profile, ledgerTimeZone: "UTC" }).ledgerTimeZone).toBe("UTC");
});
