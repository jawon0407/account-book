import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const security = await import("./session-selector.js").catch(() => ({} as Record<string, unknown>));
const createSessionSelector = security.createSessionSelector as (() => string) | undefined;
const hashSessionSelector = security.hashSessionSelector as ((selector: string) => Uint8Array) | undefined;

describe("session selectors", () => {
  it("generates a canonical 256-bit base64url selector", () => {
    expect(createSessionSelector).toBeTypeOf("function");
    const selector = createSessionSelector?.();

    expect(selector).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(selector ?? "", "base64url")).toHaveLength(32);
  });

  it("hashes a canonical selector to its SHA-256 digest", () => {
    expect(hashSessionSelector).toBeTypeOf("function");
    const selector = "A".repeat(43);
    const digest = hashSessionSelector?.(selector);

    expect(digest).toHaveLength(32);
    expect(digest).toEqual(createHash("sha256").update(selector, "utf8").digest());
  });

  it.each([
    "",
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}+`,
    ` ${"A".repeat(43)}`,
    `${"A".repeat(43)} `,
    "_".repeat(43),
  ])("rejects a non-canonical selector without echoing it", (selector) => {
    expect(() => hashSessionSelector?.(selector)).toThrow("SESSION_SELECTOR_INVALID");
    if (selector.length > 0) {
      expect(() => hashSessionSelector?.(selector)).toThrowError(
        expect.not.objectContaining({ message: expect.stringContaining(selector) }),
      );
    }
  });
});
