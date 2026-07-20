import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const module = await import("./container.js").catch(() => ({} as Record<string, unknown>));
const resolveAuthRuntime = module.resolveAuthRuntime as ((environment: Readonly<Record<string, string | undefined>>) => { mode: string; origin: URL }) | undefined;

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
});
