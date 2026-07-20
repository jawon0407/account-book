import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const module = await import("./csrf-client.js").catch(() => ({} as Record<string, unknown>));
const postWithCsrf = module.postWithCsrf as ((path: string, json: unknown, client: unknown) => Promise<unknown>) | undefined;

function result(value: unknown) {
  return { json: vi.fn(async () => value) };
}

describe("CSRF browser client", () => {
  it("fetches a fresh in-memory token for each mutation and never retries the mutation", async () => {
    expect(postWithCsrf).toBeTypeOf("function");
    const client = {
      get: vi.fn(() => result({ csrfToken: "csrf-token" })),
      post: vi.fn(() => result({ accepted: true })),
    };
    await postWithCsrf!("auth/sign-up", { email: "person@example.test", password: "a".repeat(12) }, client);
    await postWithCsrf!("auth/sign-out", {}, client);
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(client.get).toHaveBeenCalledWith("auth/csrf");
    expect(client.post).toHaveBeenNthCalledWith(1, "auth/sign-up", { json: { email: "person@example.test", password: "a".repeat(12) }, headers: { "X-CSRF-Token": "csrf-token" } });
    expect(client.post).toHaveBeenCalledTimes(2);
  });

  it("does not use browser storage", async () => {
    const source = await readFile(fileURLToPath(new URL("./csrf-client.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/iu);
  });
});
