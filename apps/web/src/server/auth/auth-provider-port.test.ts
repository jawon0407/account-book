import { expect, it } from "vitest";

const module = await import("./auth-provider-port.js").catch(() => ({} as Record<string, unknown>));

it("exports the server-only provider error boundary", () => {
  expect(module.AuthProviderError).toBeTypeOf("function");
});
