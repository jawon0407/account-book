import { describe, expect, it } from "vitest";
import { ApiErrorSchema, parseApiError } from "./index.js";

const validError = {
  code: "AUTH_INVALID_CREDENTIALS",
  message: "Credentials are invalid.",
  requestId: "request-1",
  retryable: false,
  fieldErrors: [{ field: "email", code: "INVALID" }],
};

describe("public API error contract", () => {
  it("accepts a valid error", () => {
    expect(ApiErrorSchema.parse(validError)).toEqual(validError);
    expect(parseApiError(validError)).toEqual(validError);
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
});
