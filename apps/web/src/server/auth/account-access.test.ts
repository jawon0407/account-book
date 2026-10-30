import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const module = await import("./account-access.js").catch(() => ({} as Record<string, unknown>));
const AccountAccess = module.AccountAccess as (new (query: (text: string, values: unknown[]) => Promise<{ rows: { status: string }[] }>, key: Uint8Array) => { check(email: string, kind: string, selector: string): Promise<string> }) | undefined;
const selector = Buffer.alloc(32, 3).toString("base64url");
const key = Buffer.alloc(32, 9);

describe("limited email account lookup", () => {
  it("normalizes email and uses parameterized SQL with keyed, separate fingerprints", async () => {
    expect(AccountAccess).toBeTypeOf("function");
    if (!AccountAccess) return;
    const query = vi.fn(async () => ({ rows: [{ status: "present" }] }));
    const access = new AccountAccess(query, key);
    expect(await access.check("Member@Example.test", "sign_up", selector)).toBe("present");
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toBe("select app_private.check_email_account($1,$2,$3,$4) as status");
    expect(parameters.slice(0, 2)).toEqual(["member@example.test", "sign_up"]);
    expect(parameters[2]).toBeInstanceOf(Buffer);
    expect(parameters[3]).toBeInstanceOf(Buffer);
    expect((parameters[2] as Buffer).length).toBe(32);
    expect(parameters[2]).not.toEqual(parameters[3]);
    const other = vi.fn(async () => ({ rows: [{ status: "absent" }] }));
    await new AccountAccess(other, Buffer.alloc(32, 10)).check("Member@Example.test", "sign_up", selector);
    expect((other.mock.calls[0] as unknown as [string, unknown[]])[1][2]).not.toEqual(parameters[2]);
  });

  it.each([["rate_limited", "AUTH_RATE_LIMITED"], ["unexpected", "AUTH_PROVIDER_UNAVAILABLE"]])("handles %s without exposing SQL or email", async (status, code) => {
    expect(AccountAccess).toBeTypeOf("function");
    if (!AccountAccess) return;
    const access = new AccountAccess(async () => ({ rows: [{ status: status! }] }), key);
    await expect(access.check("member@example.test", "password_reset", selector)).rejects.toMatchObject({ code });
  });

  it("fails closed when database is unavailable", async () => {
    expect(AccountAccess).toBeTypeOf("function");
    if (!AccountAccess) return;
    const access = new AccountAccess(async () => { throw new Error("private database credential"); }, key);
    await expect(access.check("member@example.test", "password_reset", selector)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", message: "AUTH_PROVIDER_UNAVAILABLE" });
  });

  it("rejects malformed input before SQL", async () => {
    expect(AccountAccess).toBeTypeOf("function");
    if (!AccountAccess) return;
    const query = vi.fn(async () => ({ rows: [{ status: "present" }] }));
    const access = new AccountAccess(query, key);
    await expect(access.check("not-email", "sign_up", selector)).rejects.toThrow();
    await expect(access.check("member@example.test", "other", selector)).rejects.toThrow();
    await expect(access.check("member@example.test", "sign_up", "bad")).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
