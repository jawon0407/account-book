import { describe, expect, it, vi } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { NativeClient } from "./native-client";

const token = "A".repeat(43);
const id = "11111111-1111-4111-8111-111111111111";
const stamp = "2026-10-16T06:53:00.000Z";
const input = {
  type: "expense" as const,
  amountKrw: 20_000,
  occurredOn: "2026-10-16",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
};
const profile = {
  id,
  nickname: null,
  avatarObjectKey: null,
  signupProvider: "email",
  role: "member",
  ledgerTimeZone: "Asia/Seoul",
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
const transaction = {
  id,
  kind: "expense",
  accountId: null,
  categoryId: null,
  counterpartyName: null,
  transferId: null,
  amountKrw: 20_000,
  occurredOn: "2026-10-16",
  memo: null,
  version: 1,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("native ledger HTTP commands", () => {
  it("uses only fixed profile/reference paths and never sends cookies", async () => {
    const requests: Request[] = [];
    const client = new NativeClient("https://ledger.example", async (raw) => {
      const request = new Request(raw);
      requests.push(request);
      return json(request.url.endsWith("profile") ? profile : { items: [] });
    });
    expect(await client.ledger.profile(token)).toEqual(profile);
    expect(await client.ledger.accounts(token)).toEqual({ items: [] });
    expect(await client.ledger.categories(token)).toEqual({ items: [] });
    expect(requests.map((value) => new URL(value.url).pathname)).toEqual([
      "/api/native/profile",
      "/api/native/accounts",
      "/api/native/categories",
    ]);
    for (const request of requests) {
      expect(request.method).toBe("GET");
      expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(request.credentials).toBe("omit");
      expect(request.redirect).toBe("error");
    }
  });
  it("sends timezone selection with expectedVersion without inventing nickname", async () => {
    let captured: Request | undefined;
    const client = new NativeClient("https://ledger.example", async (raw) => {
      captured = new Request(raw);
      return json(profile);
    });
    await client.ledger.updateProfile(token, {
      ledgerTimeZone: "Asia/Seoul",
      expectedVersion: 1,
    });
    expect(captured!.method).toBe("PATCH");
    expect(await captured!.json()).toEqual({
      ledgerTimeZone: "Asia/Seoul",
      expectedVersion: 1,
    });
  });
  it("normalizes unassigned references and preserves supplied request key", async () => {
    let captured: Request | undefined;
    const client = new NativeClient("https://ledger.example", async (raw) => {
      captured = new Request(raw);
      return json(transaction, 201);
    });
    expect(await client.ledger.createTransaction(token, input)).toEqual(
      transaction,
    );
    expect(captured!.url).toBe(
      "https://ledger.example/api/native/transactions",
    );
    expect(captured!.method).toBe("POST");
    expect(await captured!.json()).toEqual({
      ...input,
      accountId: null,
      categoryId: null,
    });
  });
  it("rejects owner and role injection before any network side effect", async () => {
    const transport = vi.fn();
    const client = new NativeClient("https://ledger.example", transport);
    await expect(
      client.ledger.createTransaction(token, {
        ...input,
        userId: id,
      } as typeof input),
    ).rejects.toMatchObject({ code: "LEDGER_VALIDATION_FAILED" });
    await expect(
      client.ledger.updateProfile(token, {
        expectedVersion: 1,
        role: "admin",
      } as never),
    ).rejects.toMatchObject({ code: "PROFILE_VALIDATION_FAILED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("never retries an ambiguous write failure", async () => {
    let calls = 0;
    const client = new NativeClient("https://ledger.example", async () => {
      calls++;
      return json(
        buildApiError({ code: "LEDGER_SERVICE_UNAVAILABLE", retryable: true }),
        503,
      );
    });
    await expect(
      client.ledger.createTransaction(token, input),
    ).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
  });
  it("rejects malformed success instead of announcing a saved transaction", async () => {
    const client = new NativeClient("https://ledger.example", async () =>
      json({ ...transaction, amountKrw: -1 }, 201),
    );
    await expect(
      client.ledger.createTransaction(token, input),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
