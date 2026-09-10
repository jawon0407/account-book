import { describe, expect, it, vi } from "vitest";
import { adapter, challenge, client, expectSafeError, jsonResponse, verifier } from "./test-fixtures.js";

vi.mock("server-only", () => ({}));

describe("Supabase error mapping through the public adapter", () => {
  it.each([
    { body: { code: "bad_code_verifier", message: "secret provider text" }, status: 400, expected: "AUTH_OAUTH_TRANSACTION_INVALID" },
    { body: { code: "over_request_rate_limit" }, status: 429, expected: "AUTH_RATE_LIMITED" },
    { body: { code: "unexpected" }, status: 503, expected: "AUTH_PROVIDER_UNAVAILABLE" },
    { body: { code: "unexpected", status: 400 }, status: 503, expected: "AUTH_PROVIDER_UNAVAILABLE" },
    { body: { code: "configuration_error" }, status: 400, expected: "AUTH_PROVIDER_UNAVAILABLE" },
  ])("maps PKCE HTTP failures to fixed safe errors", async ({ body, status, expected }) => {
    const setup = adapter([jsonResponse(body, status)]);
    await expectSafeError(() => setup.adapter.exchangeOAuthCode({ code: "secret-code", codeVerifier: verifier }), expected, "secret-code", verifier, "secret provider text");
  });

  it("preserves an actual HTTP 429 when the response body is malformed JSON", async () => {
    const malformed = new Response("not-json", { status: 429, headers: { "content-type": "application/json" } });
    await expectSafeError(() => adapter([malformed]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier }), "AUTH_RATE_LIMITED");
  });

  it.each(["scalar", []])("preserves an actual HTTP 429 when the JSON body is non-object %#", async (body) => {
    await expectSafeError(() => adapter([jsonResponse(body, 429)]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier }), "AUTH_RATE_LIMITED");
  });

  it.each(["user_already_exists", "email_exists", "user_already_registered", "email_already_exists"])(
    "preserves the signup acknowledgement for provider existence code %s",
    async (code) => {
      const setup = adapter([jsonResponse({ code, message: "hostile" }, 400)]);
      await expect(setup.adapter.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm"), challenge)).resolves.toEqual({ status: "verification_required" });
    },
  );

  it("does not collapse signup existence codes returned with an unrelated HTTP status", async () => {
    const setup = adapter([jsonResponse({ code: "user_already_exists", status: 400 }, 503)]);
    await expectSafeError(
      () => setup.adapter.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm"), challenge),
      "AUTH_PROVIDER_UNAVAILABLE",
    );
  });

  it("rejects unrelated signup failures instead of treating every 400 as credential invalid", async () => {
    const setup = adapter([jsonResponse({ code: "configuration_error" }, 400)]);
    await expectSafeError(
      () => setup.adapter.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm"), challenge),
      "AUTH_PROVIDER_UNAVAILABLE",
    );
  });

  it.each(["user_not_found", "email_not_found", "user_not_exist", "email_not_exists"])(
    "preserves the recovery acknowledgement for absent-account code %s",
    async (code) => {
      const setup = adapter([jsonResponse({ code, message: "hostile" }, 400)]);
      await expect(setup.adapter.requestPasswordReset("absent@example.test", new URL("https://app.example.test/recovery"), challenge)).resolves.toBeUndefined();
    },
  );

  it("does not collapse recovery absence codes returned with an unrelated HTTP status", async () => {
    const setup = adapter([jsonResponse({ code: "user_not_found", status: 400 }, 503)]);
    await expectSafeError(
      () => setup.adapter.requestPasswordReset("absent@example.test", new URL("https://app.example.test/recovery"), challenge),
      "AUTH_PROVIDER_UNAVAILABLE",
    );
  });

  it("rejects unrelated recovery failures instead of treating every 400 as credential invalid", async () => {
    const setup = adapter([jsonResponse({ code: "configuration_error" }, 400)]);
    await expectSafeError(
      () => setup.adapter.requestPasswordReset("person@example.test", new URL("https://app.example.test/recovery"), challenge),
      "AUTH_PROVIDER_UNAVAILABLE",
    );
  });

  it("maps SDK provider errors without returning provider text or token values", async () => {
    const setup = adapter([], client({ signInWithPassword: vi.fn(async () => ({ data: null, error: { status: 401, message: "hostile refresh-token" } })) }));
    await expectSafeError(() => setup.adapter.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }), "AUTH_INVALID_CREDENTIALS", "hostile", "refresh-token");
  });
});
