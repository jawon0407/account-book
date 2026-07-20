import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@account-book/database", () => ({ createDatabaseClient: vi.fn(() => ({ sharedDatabase: true })) }));
const module = await import("./container.js").catch(() => ({} as Record<string, unknown>));
const resolveAuthRuntime = module.resolveAuthRuntime as ((environment: Readonly<Record<string, string | undefined>>) => { mode: string; origin: URL }) | undefined;
const createRequestContainer = module.createRequestContainer as ((environment: Readonly<Record<string, string | undefined>>) => { authController: unknown }) | undefined;
const { createDatabaseClient } = await import("@account-book/database");

const key = Buffer.alloc(32, 7).toString("base64url");
const runtimeEnvironment = {
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:3000",
  AUTH_ADAPTER_MODE: "fake",
  DATABASE_URL: "postgres://database.example.test/account_book",
  API_INTERNAL_URL: "http://api.internal.test:3001",
  AUTH_TOKEN_KEY_ID: "current",
  AUTH_TOKEN_KEY: key,
  AUTH_CSRF_HMAC_KEY: key,
} as const;

describe("authentication runtime selection", () => {
  it("defaults to the Supabase adapter", () => {
    expect(resolveAuthRuntime).toBeTypeOf("function");
    expect(resolveAuthRuntime!({ NODE_ENV: "production", APP_ORIGIN: "https://app.example.test" })).toMatchObject({ mode: "supabase", origin: new URL("https://app.example.test") });
  });

  it.each([
    { NODE_ENV: "production", APP_ORIGIN: "https://localhost", AUTH_ADAPTER_MODE: "fake" },
    { NODE_ENV: "development", APP_ORIGIN: "https://app.example.test", AUTH_ADAPTER_MODE: "fake" },
    { NODE_ENV: "test", APP_ORIGIN: "http://localhost.evil.test", AUTH_ADAPTER_MODE: "fake" },
  ])("rejects fake mode outside non-production exact loopback %#", (environment) => {
    expect(resolveAuthRuntime).toBeTypeOf("function");
    expect(() => resolveAuthRuntime!(environment)).toThrow("AUTH_CONFIGURATION_INVALID");
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("allows fake mode on non-production loopback %s", (hostname) => {
    expect(resolveAuthRuntime).toBeTypeOf("function");
    expect(resolveAuthRuntime!({ NODE_ENV: "test", APP_ORIGIN: `http://${hostname}:3000`, AUTH_ADAPTER_MODE: "fake" })).toMatchObject({ mode: "fake" });
  });

  it.each([
    "https://user:pass@app.example.test",
    "https://app.example.test/path",
    "https://app.example.test?query=1",
    "https://app.example.test#fragment",
    "http://app.example.test",
  ])("rejects a non-canonical application origin %s", (origin) => {
    expect(resolveAuthRuntime).toBeTypeOf("function");
    expect(() => resolveAuthRuntime!({ NODE_ENV: "development", APP_ORIGIN: origin })).toThrow("AUTH_CONFIGURATION_INVALID");
  });

  it("reuses one lazy database pool while rebuilding the request-owned graph", async () => {
    expect(createRequestContainer).toBeTypeOf("function");
    const first = createRequestContainer!(runtimeEnvironment);
    const second = createRequestContainer!(runtimeEnvironment);
    expect(first.authController).not.toBe(second.authController);
    expect(createDatabaseClient).toHaveBeenCalledTimes(1);
    const csrf = await (first.authController as { csrf(request: Request): Promise<Response> }).csrf(new Request("http://localhost:3000/api/auth/csrf"));
    expect(csrf.headers.get("Set-Cookie")).toMatch(/__Host-ab_interaction=.*; Secure;/u);
    expect(() => createRequestContainer!({ ...runtimeEnvironment, DATABASE_URL: "postgres://other.example.test/account_book" })).toThrow("AUTH_CONFIGURATION_INVALID");
    expect(createDatabaseClient).toHaveBeenCalledTimes(1);
  });
});
