import { describe, expect, it } from "vitest";
import { ApiErrorCodeSchema, ApiErrorSchema, parseApiError } from "./index.js";

const validError = {
  code: "AUTH_INVALID_CREDENTIALS",
  message: "Credentials are invalid.",
  requestId: "request-1",
  retryable: false,
  fieldErrors: [{ field: "email", code: "INVALID" }],
};

const ledgerCodes = [
  "LEDGER_VALIDATION_FAILED",
  "LEDGER_NOT_FOUND",
  "LEDGER_VERSION_CONFLICT",
  "LEDGER_IDEMPOTENCY_CONFLICT",
  "LEDGER_ACCOUNT_UNAVAILABLE",
  "LEDGER_CATEGORY_UNAVAILABLE",
  "LEDGER_TRANSFER_INVALID",
] as const;

describe("public API error contract", () => {
  it("accepts a valid error", () => {
    expect(ApiErrorSchema.parse(validError)).toEqual(validError);
    expect(parseApiError(validError)).toEqual(validError);
  });

  it("accepts a one-character message", () => {
    expect(ApiErrorSchema.parse({ ...validError, message: "a" }).message).toBe("a");
  });

  it("accepts an eight-character request ID", () => {
    expect(ApiErrorSchema.parse({ ...validError, requestId: "request1" }).requestId).toBe("request1");
  });

  it("accepts twenty field errors", () => {
    const fieldErrors = Array.from({ length: 20 }, () => ({ field: "email", code: "INVALID" }));

    expect(ApiErrorSchema.parse({ ...validError, fieldErrors }).fieldErrors).toEqual(fieldErrors);
  });

  it("rejects invalid codes and string length boundaries", () => {
    expect(() => ApiErrorSchema.parse({ ...validError, code: "AUTH_UNKNOWN" })).toThrow();
    expect(() => ApiErrorSchema.parse({ ...validError, message: "a".repeat(301) })).toThrow();
    expect(() => ApiErrorSchema.parse({ ...validError, requestId: "short" })).toThrow();
    expect(() => ApiErrorSchema.parse({ ...validError, requestId: "a".repeat(129) })).toThrow();
  });

  it("rejects too many field errors and nested extra fields", () => {
    expect(() => ApiErrorSchema.parse({ ...validError, fieldErrors: Array.from({ length: 21 }, () => ({ field: "email", code: "INVALID" })) })).toThrow();
    expect(() => ApiErrorSchema.parse({ ...validError, fieldErrors: [{ field: "email", code: "INVALID", detail: "secret" }] })).toThrow();
  });

  it("does not accept raw secret-bearing properties", () => {
    expect(() => parseApiError({ ...validError, stack: "SQL SELECT token FROM sessions", accessToken: "secret", cookie: "session=secret", oauthCode: "code" })).toThrow();
  });


  it("accepts only the approved public ledger error codes", () => {
    for (const code of ledgerCodes) {
      expect(ApiErrorCodeSchema.parse(code)).toBe(code);
      expect(ApiErrorSchema.parse({ ...validError, code })).toMatchObject({ code });
    }
    for (const code of ["LEDGER_SQL_ERROR", "LEDGER_OWNER_MISMATCH", "LEDGER_INTERNAL"]) {
      expect(() => ApiErrorCodeSchema.parse(code)).toThrow();
    }
  });

  it("rejects ledger errors carrying internal or financial fields", () => {
    expect(() => parseApiError({
      ...validError,
      code: "LEDGER_NOT_FOUND",
      memo: "실제 거래 메모",
      sql: "select * from transactions",
      table: "transactions",
    })).toThrow();
  });
});
