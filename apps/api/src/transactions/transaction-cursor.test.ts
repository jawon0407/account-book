import { describe, expect, it } from "vitest";
import { encodeCursor, decodeCursor } from "./transaction-cursor.js";
import { parseTransactionQuery } from "./transaction-query.js";
const user = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
describe("transaction query and bound cursor", () => {
  it("round trips the date/id boundary and normalized filter set", () => {
    const token = encodeCursor(user, { type: "expense", limit: 1 }, { occurredOn: "2026-10-01", id });
    expect(decodeCursor(user, { type: "expense", limit: 100, cursor: token })).toEqual({ date: "2026-10-01", id });
    expect(Buffer.from(token, "base64url").toString()).not.toContain(user);
    expect(decodeCursor(user, {})).toBeNull();
    for (const [owner, query] of [[id, { type: "expense" }], [user, { type: "income" }]] as const)
      expect(() => decodeCursor(owner, { ...query, cursor: token })).toThrow("LEDGER_VALIDATION_FAILED");
  });
  it.each(["!", "abc", "A".repeat(513), Buffer.from('{"v":2}').toString("base64url")])("rejects malformed cursor", cursor => {
    expect(() => decodeCursor(user, { cursor })).toThrow("LEDGER_VALIDATION_FAILED");
  });
  it("requires canonical encoding and strict payload fields", () => {
    const token = encodeCursor(user, {}, { occurredOn: "2026-10-01", id });
    const value = JSON.parse(Buffer.from(token, "base64url").toString());
    for (const changed of [{ ...value, extra: true }, { ...value, date: "2026-02-30" }, { ...value, id: "x" }])
      expect(() => decodeCursor(user, { cursor: Buffer.from(JSON.stringify(changed)).toString("base64url") })).toThrow();
    expect(() => decodeCursor(user, { cursor: Buffer.from(JSON.stringify(value, null, 1)).toString("base64url") })).toThrow();
  });
  it("converts only the HTTP page size and normalizes UUID filters", () => {
    expect(parseTransactionQuery({ limit: "25", accountId: id.toUpperCase() })).toEqual({ limit: 25, accountId: id });
    expect(parseTransactionQuery({})).toEqual({});
  });
  it.each([{ limit: "0" }, { limit: "101" }, { limit: "1.5" }, { limit: "01" }, { limit: ["1", "2"] }, { limit: 2 },
    { from: "2026-10-02", to: "2026-10-01" }, { owner: user }, { type: ["income", "expense"] }, null])("rejects ambiguous HTTP input", raw => {
    expect(() => parseTransactionQuery(raw)).toThrow("LEDGER_VALIDATION_FAILED");
  });
});
