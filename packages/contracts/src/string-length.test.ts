import { describe, expect, it } from "vitest";
import { AccountNameSchema } from "./accounts.js";
import { CategoryNameSchema } from "./categories.js";
import { PasswordUpdateInputSchema, SignInInputSchema, SignUpInputSchema } from "./auth.js";
import { UpdateProfileInputSchema } from "./profiles.js";
import { CreateTransactionInputSchema, CreateTransferInputSchema, UpdateTransactionInputSchema } from "./transactions.js";

const transaction = { amountKrw: 100, idempotencyKey: "11111111-1111-4111-8111-111111111111", occurredOn: "2026-10-28", type: "expense" };

describe("existing UTF-16 input boundaries survive dependency updates", () => {
  it.each([
    ["account", 80, (value: string) => AccountNameSchema.safeParse(value).success],
    ["category", 50, (value: string) => CategoryNameSchema.safeParse(value).success],
    ["nickname", 50, (value: string) => UpdateProfileInputSchema.safeParse({ nickname: value, expectedVersion: 1 }).success],
    ["counterparty create", 200, (value: string) => CreateTransactionInputSchema.safeParse({ ...transaction, counterpartyName: value }).success],
    ["counterparty update", 200, (value: string) => UpdateTransactionInputSchema.safeParse({ counterpartyName: value, expectedVersion: 1 }).success],
    ["memo create", 500, (value: string) => CreateTransactionInputSchema.safeParse({ ...transaction, memo: value }).success],
    ["memo update", 500, (value: string) => UpdateTransactionInputSchema.safeParse({ memo: value, expectedVersion: 1 }).success],
    ["transfer memo", 500, (value: string) => CreateTransferInputSchema.safeParse({ amountKrw: 100, idempotencyKey: transaction.idempotencyKey, occurredOn: transaction.occurredOn, fromAccountId: transaction.idempotencyKey, toAccountId: "22222222-2222-4222-8222-222222222222", memo: value }).success],
  ] as const)("preserves %s trimming and inclusive maximum", (_name, maximum, accepts) => {
    expect(accepts("   ")).toBe(false);
    expect(accepts(`  ${"가".repeat(maximum)}  `)).toBe(true);
    expect(accepts("가".repeat(maximum + 1))).toBe(false);
    expect(accepts("😀".repeat(maximum / 2))).toBe(true);
    expect(accepts("😀".repeat(maximum / 2) + "x")).toBe(false);
  });

  it.each([SignInInputSchema, SignUpInputSchema, PasswordUpdateInputSchema])("does not lock out existing supplementary-character passwords or expand maximum", schema => {
    const accepts = (password: string) => schema.safeParse(schema === PasswordUpdateInputSchema ? { password } : { email: "synthetic@example.invalid", password }).success;
    expect(accepts("😀".repeat(5) + "x")).toBe(false);
    expect(accepts("😀".repeat(6))).toBe(true);
    expect(accepts("😀".repeat(512))).toBe(true);
    expect(accepts("😀".repeat(512) + "x")).toBe(false);
  });
});
