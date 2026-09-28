import { describe, expect, it } from "vitest";
import { BankConnectionRequestStatusSchema } from "./bank-connections.js";

const requestId = "11111111-1111-4111-8111-111111111111";

describe("bank connection public contract", () => {
  it("accepts only a public request status", () => {
    expect(BankConnectionRequestStatusSchema.parse({
      requestId, status: "awaiting_callback",
    })).toEqual({ requestId, status: "awaiting_callback" });
  });
  it.each(["accessToken", "refreshToken", "code", "state", "proof", "userId"])(
    "rejects unexpected %s",
    (field) => expect(BankConnectionRequestStatusSchema.safeParse({
      requestId, status: "connected", [field]: "not-a-real-secret",
    }).success).toBe(false),
  );
  it("does not accept unknown status or malformed request ID", () => {
    expect(BankConnectionRequestStatusSchema.safeParse({
      requestId, status: "success_guess",
    }).success).toBe(false);
    expect(BankConnectionRequestStatusSchema.safeParse({
      requestId: "not-an-id", status: "connected",
    }).success).toBe(false);
  });
});
