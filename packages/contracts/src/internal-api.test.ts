import { describe, expect, it } from "vitest";
import {
  canonicalDelegatedRequest,
  DELEGATED_JSON_BODY_MAX_BYTES,
  DelegatedScopeSchema,
  normalizeDelegatedContentType,
} from "./internal-api.js";

describe("delegated internal API request contract", () => {
  it("sets the shared JSON request-body limit to 32 KiB", () => {
    expect(DELEGATED_JSON_BODY_MAX_BYTES).toBe(32_768);
  });

  it("allows only the delegated capabilities required by the BFF", () => {
    for (const scope of [
      "me:read",
      "account:read",
      "account:write",
      "category:read",
      "category:write",
      "transaction:read",
      "transaction:write",
      "dashboard:read",
    ]) {
      expect(DelegatedScopeSchema.safeParse(scope).success).toBe(true);
    }

    for (const scope of ["admin", "transaction:*", "user:write", ""]) {
      expect(DelegatedScopeSchema.safeParse(scope).success).toBe(false);
    }
  });

  it("sorts query pairs and binds the exact body digest and request ID", () => {
    expect(canonicalDelegatedRequest({
      bodySha256: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      contentType: null,
      method: "GET",
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      target: "/v1/me?z=2&a=1&a=0",
    })).toBe([
      "GET",
      "/v1/me?a=1&a=0&z=2",
      "",
      "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      "123e4567-e89b-42d3-a456-426614174000",
    ].join("\n"));
  });

  it("normalizes only the JSON content types accepted by protected APIs", () => {
    expect(normalizeDelegatedContentType(null)).toBe("");
    expect(normalizeDelegatedContentType("APPLICATION/JSON; CHARSET=UTF-8")).toBe("application/json");
    for (const value of ["text/plain", "application/json; profile=x", "application/json\nx"]) {
      expect(() => normalizeDelegatedContentType(value)).toThrow("DELEGATED_REQUEST_INVALID");
    }
  });

  it.each([
    ["lowercase method", { method: "get" }],
    ["absolute target", { target: "https://evil.test/v1/me" }],
    ["fragment", { target: "/v1/me#x" }],
    ["invalid body digest", { bodySha256: "short" }],
    ["invalid request ID", { requestId: "not-a-uuid" }],
  ])("rejects %s", (_name, override) => {
    expect(() => canonicalDelegatedRequest({
      bodySha256: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      contentType: null,
      method: "GET",
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      target: "/v1/me",
      ...override,
    })).toThrow("DELEGATED_REQUEST_INVALID");
  });
});
