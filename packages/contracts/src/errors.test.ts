import { AccountListQuerySchema, ArchiveAccountInputSchema, CreateAccountInputSchema, CreateCategoryInputSchema, CreateTransactionInputSchema, CreateTransferInputSchema, DeleteTransactionInputSchema, SetOpeningBalanceInputSchema, TransactionListQuerySchema, UpdateAccountInputSchema, UpdateCategoryInputSchema, UpdateTransactionInputSchema } from "./index.js";
import { describe, expect, it } from "vitest";
import { ApiErrorCodeSchema, ApiErrorSchema, buildApiError, parseApiError, PublicErrorMessages, PublicFieldErrorFields, sanitizeApiErrorInput } from "./index.js";

const validError = {
  code: "AUTH_INVALID_CREDENTIALS",
  message: "The authentication input was rejected.",
  requestId: "123e4567-e89b-12d3-a456-426614174000",
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

  it("rejects a non-derived message", () => {
    expect(() => ApiErrorSchema.parse({ ...validError, message: "a" })).toThrow();
  });

  it("requires a canonical UUID request ID", () => {
    expect(() => ApiErrorSchema.parse({ ...validError, requestId: "request1" })).toThrow();
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
      expect(ApiErrorSchema.parse({ ...validError, code, message: PublicErrorMessages[code] })).toMatchObject({ code });
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


describe("public API error sanitization", () => {
  it("replaces untrusted messages and discards sensitive field errors", () => {
    const parsed = sanitizeApiErrorInput({ ...validError, code: "LEDGER_NOT_FOUND", message: "SQL select memo from transactions", fieldErrors: [{ field: "memo: 실제 금융 메모", code: "select * from secrets" }] });
    expect(parsed.message).toBe("The requested ledger resource was not found.");
    expect(parsed.fieldErrors).toEqual([]);
    expect(JSON.stringify(parsed)).not.toMatch(/SQL|select|실제 금융 메모|secrets/iu);
  });
});

describe("strict public error builder", () => {
  it("normalizes untrusted request IDs and messages before wire serialization", () => {
    const body = buildApiError({ code: "LEDGER_NOT_FOUND", requestId: "SQL secret memo", message: "select * from accounts", retryable: false, fieldErrors: [{ field: "memo: secret", code: "DROP TABLE" }] });
    expect(body.message).toBe("The requested ledger resource was not found.");
    expect(body.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    expect(JSON.stringify(body)).not.toMatch(/SQL|secret|memo:|DROP|select/iu);
    expect(ApiErrorSchema.parse(body)).toEqual(body);
  });

  it("generates distinct UUIDs for invalid request IDs", () => {
    const first = buildApiError({ code: "LEDGER_NOT_FOUND", requestId: "secret", retryable: false });
    const second = buildApiError({ code: "LEDGER_NOT_FOUND", requestId: "secret", retryable: false });
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(second.requestId).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(first.requestId).not.toBe(second.requestId);
  });

  it("defines every exported ledger request/query field in the public field allowlist", () => {
    const schemas = [CreateAccountInputSchema, UpdateAccountInputSchema, ArchiveAccountInputSchema, SetOpeningBalanceInputSchema, CreateCategoryInputSchema, UpdateCategoryInputSchema, CreateTransactionInputSchema, UpdateTransactionInputSchema, DeleteTransactionInputSchema, CreateTransferInputSchema, TransactionListQuerySchema, AccountListQuerySchema];
    const intentionalAuthFields = ["email", "password", "provider", "returnPath"];
    const expected = [...new Set([...schemas.flatMap((schema) => Object.keys(schema.shape)), ...intentionalAuthFields])];
    expect(new Set(PublicFieldErrorFields.options)).toEqual(new Set(expected));
  });
});
