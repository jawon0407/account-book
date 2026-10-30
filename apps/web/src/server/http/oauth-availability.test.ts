import { afterEach, expect, it, vi } from "vitest";
import { oauthAvailabilityResponse } from "./oauth-availability.js";
import { GET, POST, OPTIONS } from "../../app/api/auth/providers/route.js";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());

it("returns only explicit provider names without secrets or a database connection", async () => {
  const response = oauthAvailabilityResponse({ AUTH_ENABLED_PROVIDERS: '["google"]', SUPABASE_ANON_KEY: "secret-not-public" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabledProviders: ["google"] });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Set-Cookie")).toBeNull();
});

it("defaults off at the actual route and reads new configuration per request", async () => {
  vi.stubEnv("AUTH_ENABLED_PROVIDERS", undefined);
  expect(await GET().json()).toEqual({ enabledProviders: [] });
  vi.stubEnv("AUTH_ENABLED_PROVIDERS", '["kakao"]');
  expect(await GET().json()).toEqual({ enabledProviders: ["kakao"] });
});

it("fails closed on malformed configuration without reflecting it", async () => {
  const response = oauthAvailabilityResponse({ AUTH_ENABLED_PROVIDERS: "secret-malformed" });
  expect(response.status).toBe(503);
  const text = await response.text();
  expect(text).not.toContain("secret-malformed");
  expect(JSON.parse(text)).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
});

it("rejects unsupported methods without enabling CORS", () => {
  for (const handler of [POST, OPTIONS]) {
    const response = handler(new Request("https://app.example.test/api/auth/providers"));
    expect(response.status).toBe(405);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  }
});
