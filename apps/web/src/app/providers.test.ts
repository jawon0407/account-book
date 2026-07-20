import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const module = await import("./providers.js");
const { createQueryClient } = module;

describe("application providers", () => {
  it("creates retry-disabled TanStack clients and keeps one client per provider mount", async () => {
    expect(createQueryClient).toBeTypeOf("function");
    const options = createQueryClient().getDefaultOptions();
    expect(options.queries).toMatchObject({ retry: false });
    expect(options.mutations).toMatchObject({ retry: false });

    const source = await readFile(fileURLToPath(new URL("./providers.tsx", import.meta.url)), "utf8");
    expect(source).toContain('"use client"');
    expect(source).toContain("QueryClientProvider");
    expect(source).toMatch(/useState\(createQueryClient\)/u);
    expect(source).not.toMatch(/zustand|localStorage|sessionStorage/iu);
  });
});
