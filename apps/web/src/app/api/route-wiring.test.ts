import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const routes = [
  "auth/csrf/route.ts",
  "auth/sign-up/route.ts",
  "auth/sign-in/route.ts",
  "auth/email/callback/route.ts",
  "auth/oauth/[provider]/start/route.ts",
  "auth/oauth/[provider]/continue/route.ts",
  "auth/callback/route.ts",
  "auth/session/route.ts",
  "auth/session/refresh/route.ts",
  "auth/sign-out/route.ts",
  "auth/password/reset-request/route.ts",
  "auth/password/callback/route.ts",
  "auth/password/update/route.ts",
  "me/route.ts",
] as const;

describe("Next authentication route wiring", () => {
  it.each(routes)("keeps %s as a thin request-scoped adapter", async (relativePath) => {
    const route = fileURLToPath(new URL(relativePath, import.meta.url));
    const source = await readFile(route, "utf8");
    expect(source).toContain("handleAuthRoute");
    expect(source).not.toMatch(/Supabase|Postgres|process\.env|DATABASE_URL|API_INTERNAL_URL/u);
    expect(source.split(/\r?\n/u).length).toBeLessThanOrEqual(12);
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) expect(source).toMatch(new RegExp(`(?:const|as) ${method}\\b`, "u"));
  });

  it("runs explicit HEAD, OPTIONS, and wrong-method handlers instead of Next defaults", async () => {
    const signIn = await import("./auth/sign-in/route.js");
    const csrf = await import("./auth/csrf/route.js");
    for (const [handler, method] of [[signIn.HEAD, "HEAD"], [signIn.OPTIONS, "OPTIONS"], [signIn.GET, "GET"], [csrf.HEAD, "HEAD"], [csrf.POST, "POST"]] as const) {
      expect(handler).toBeTypeOf("function");
      const response = await handler!(new Request("https://app.example.test/api/auth/csrf", { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Pragma")).toBe("no-cache");
      expect(response.headers.get("Expires")).toBe("0");
    }
  });
});
