import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const module = await import("./auth-provider-port.js").catch(() => ({} as Record<string, unknown>));

it("exports the server-only provider error boundary", () => {
  expect(module.AuthProviderError).toBeTypeOf("function");
});

it("marks the token-bearing provider port as server-only", async () => {
  const source = await readFile(new URL("./auth-provider-port.ts", import.meta.url), "utf8");
  expect(source.startsWith('import "server-only";')).toBe(true);
});
