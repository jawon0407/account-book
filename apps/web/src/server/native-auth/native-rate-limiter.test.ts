import { describe, expect, it, vi } from "vitest";
import type { NativeRateScope, NativeRateOperation } from "./native-types.js";
const module = await import("./native-rate-limiter.js").catch(() => ({} as Record<string, unknown>));
const Limiter = module.NativeRateLimiter as new (query: (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>, key: Uint8Array) => { consume(operation: NativeRateOperation, scope: NativeRateScope, value: string): Promise<boolean> };

describe("native shared rate limiter", () => {
  it.each([["ledgerRead", 1200, 60], ["ledgerWrite", 600, 30]] as const)("separates %s from auth budgets", async (operation, globalLimit, identityLimit) => {
    const query = vi.fn<(text: string, values: unknown[]) => Promise<{ rows: unknown[] }>>(async () => ({ rows: [{ count: 1 }] }));
    const limiter = new Limiter(query, new Uint8Array(32));
    await limiter.consume(operation, "global", "all");
    await limiter.consume(operation, "identity", "user:device");
    expect(query.mock.calls[0]![1].slice(1)).toEqual([60, globalLimit, true]);
    expect(query.mock.calls[1]![1].slice(1)).toEqual([60, identityLimit, false]);
    expect(query.mock.calls[0]![1][0]).not.toEqual(query.mock.calls[1]![1][0]);
  });
  it("uses an opaque scoped fingerprint and denies requests above the budget", async () => {
    expect(Limiter).toBeTypeOf("function");
    const query = vi.fn<(text: string, values: unknown[]) => Promise<{ rows: unknown[] }>>(async () => ({ rows: [{ count: 6 }] }));
    const limiter = new Limiter(query, new Uint8Array(32).fill(3));
    expect(await limiter.consume("signIn", "email", "person@example.test")).toBe(true);
    const values = query.mock.calls[0]![1];
    expect(values[0]).toBeInstanceOf(Buffer);
    expect((values[0] as Buffer).length).toBe(32);
    expect(JSON.stringify(values)).not.toContain("person@example.test");
    query.mockResolvedValueOnce({ rows: [{ count: 7 }] });
    expect(await limiter.consume("signIn", "email", "person@example.test")).toBe(false);
    await limiter.consume("signIn", "device", "person@example.test");
    expect(query.mock.calls[2]![1][0]).not.toEqual(values[0]);
  });
  it("fails closed on invalid budgets, inputs and database results", async () => {
    expect(Limiter).toBeTypeOf("function");
    expect(() => new Limiter(async () => ({ rows: [] }), new Uint8Array(2))).toThrow();
    const query = vi.fn<(text: string, values: unknown[]) => Promise<{ rows: unknown[] }>>(async () => ({ rows: [] }));
    const limiter = new Limiter(query, new Uint8Array(32));
    await expect(limiter.consume("session", "email", "a")).rejects.toThrow();
    await expect(limiter.consume("signIn", "email", "")).rejects.toThrow();
    await expect(limiter.consume("signIn", "email", "a".repeat(1025))).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    for (const rows of [[], [{ count: "1" }], [{ count: -1 }], [{ count: 1.5 }], [{ count: 1 }, { count: 1 }]]) {
      query.mockResolvedValueOnce({ rows });
      await expect(limiter.consume("signIn", "global", "all")).rejects.toThrow();
    }
    query.mockRejectedValueOnce(new Error("db"));
    await expect(limiter.consume("session", "global", "all")).rejects.toThrow();
  });
  it("isolates per-operation identities and uses the corresponding global budgets", async () => {
    const query = vi.fn<(text: string, values: unknown[]) => Promise<{ rows: unknown[] }>>(async () => ({ rows: [{ count: 1 }] }));
    const limiter = new Limiter(query, new Uint8Array(32));
    for (const operation of ["session", "refresh", "signOut"] as const) {
      expect(await limiter.consume(operation, "global", "all")).toBe(true);
      expect(await limiter.consume(operation, "identity", "user:device")).toBe(true);
    }
    expect(new Set(query.mock.calls.map(call => (call[1][0] as Buffer).toString("hex"))).size).toBe(6);
    await expect(limiter.consume("invalid" as NativeRateOperation, "global", "all")).rejects.toThrow();
  });
});
