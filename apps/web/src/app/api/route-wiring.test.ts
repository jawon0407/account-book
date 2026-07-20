import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routes = [
  "auth/csrf/route.ts",
  "auth/sign-up/route.ts",
  "auth/sign-in/route.ts",
  "auth/email/callback/route.ts",
  "auth/oauth/[provider]/start/route.ts",
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
  });
});
