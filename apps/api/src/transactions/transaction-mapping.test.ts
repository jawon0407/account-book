import { describe, expect, it } from "vitest";
import { transaction } from "./transaction-mapping.js";
const id = "11111111-1111-4111-8111-111111111111";
const row = { id, account_id: id, category_id: id, transfer_id: null, amount_krw: "9007199254740991", occurred_on: "2026-10-01", memo: null, version: "1", deleted_at: null, created_at: new Date("2026-10-01Z"), updated_at: new Date("2026-10-01Z") };
describe("transaction public mapping", () => {
  it.each(["income", "expense", "transfer_in", "transfer_out", "opening_balance"])("maps %s without internal data", kind => {
    const result = transaction({ ...row, kind, user_id: "secret", category_id: kind === "income" || kind === "expense" ? id : null, transfer_id: kind.startsWith("transfer") ? id : null, opening_direction: kind === "opening_balance" ? "asset" : null });
    expect(result.amountKrw).toBe(Number.MAX_SAFE_INTEGER); expect(result.occurredOn).toBe("2026-10-01");
    expect(result).not.toHaveProperty("user_id");
    expect("direction" in result).toBe(kind === "opening_balance");
  });
  it("rejects unsafe bigint rather than rounding", () => {
    expect(() => transaction({ ...row, kind: "expense", amount_krw: "9007199254740992" })).toThrow();
  });
});
