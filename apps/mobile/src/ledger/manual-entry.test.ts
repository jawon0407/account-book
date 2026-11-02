import { describe, expect, it } from "vitest";
import type {
  CreateTransactionInput,
  Transaction,
} from "@account-book/contracts";
import { ClientError } from "../api/client-error";
import { ManualEntry } from "./manual-entry";

const key = "22222222-2222-4222-8222-222222222222";
const input = {
  type: "expense" as const,
  amountKrw: 20000,
  occurredOn: "2026-10-16",
};
const stamp = "2026-10-16T06:53:00.000Z";
const saved: Transaction = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "expense",
  amountKrw: 20000,
  occurredOn: "2026-10-16",
  accountId: null,
  categoryId: null,
  counterpartyName: null,
  memo: null,
  transferId: null,
  version: 1,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("one explicit manual save attempt", () => {
  it("coalesces duplicate taps and does not generate another request key", async () => {
    const response = deferred<Transaction>();
    let calls = 0,
      keys = 0;
    const entry = new ManualEntry(
      async () => {
        calls++;
        return response.promise;
      },
      () => {
        keys++;
        return key;
      },
    );
    const a = entry.submit(input),
      b = entry.submit(input);
    expect(entry.snapshot().status).toBe("saving");
    response.resolve(saved);
    expect(await a).toEqual(saved);
    expect(await b).toEqual(saved);
    expect(calls).toBe(1);
    expect(keys).toBe(1);
    expect(entry.snapshot()).toMatchObject({
      status: "saved",
      transaction: saved,
    });
  });
  it("retains the exact key and payload after an ambiguous network result", async () => {
    const requests: CreateTransactionInput[] = [];
    let keys = 0;
    const entry = new ManualEntry(
      async (value) => {
        requests.push(value);
        if (requests.length === 1) throw new ClientError("NETWORK");
        return saved;
      },
      () => {
        keys++;
        return key;
      },
    );
    await expect(entry.submit(input)).rejects.toMatchObject({
      code: "NETWORK",
    });
    expect(entry.snapshot().status).toBe("uncertain");
    await expect(
      entry.submit({ ...input, amountKrw: 30000 }),
    ).rejects.toThrow();
    expect(entry.beginNew()).toBe(false);
    expect(await entry.retry()).toEqual(saved);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[1]!.idempotencyKey).toBe(key);
    expect(keys).toBe(1);
  });
  it.each([
    new ClientError("INVALID_RESPONSE"),
    new ClientError("LEDGER_SERVICE_UNAVAILABLE", 503),
    new ClientError("LEDGER_IDEMPOTENCY_CONFLICT", 409),
    new Error("opaque transport failure"),
  ])(
    "treats lost or contradictory responses as uncertain without raw error disclosure",
    async (failure) => {
      const entry = new ManualEntry(
        async () => {
          throw failure;
        },
        () => key,
      );
      await expect(entry.submit(input)).rejects.toThrow();
      expect(entry.snapshot()).toMatchObject({ status: "uncertain" });
      expect(JSON.stringify(entry.snapshot())).not.toContain(
        "opaque transport failure",
      );
      expect(entry.beginNew()).toBe(false);
      entry.confirmListChecked();
      expect(entry.snapshot().status).toBe("editing");
    },
  );
  it("allows correcting a definitively rejected input", async () => {
    const entry = new ManualEntry(
      async () => {
        throw new ClientError("LEDGER_CATEGORY_UNAVAILABLE", 409);
      },
      () => key,
    );
    await expect(entry.submit(input)).rejects.toThrow();
    expect(entry.snapshot()).toMatchObject({
      status: "failed",
      error: "LEDGER_CATEGORY_UNAVAILABLE",
    });
    expect(entry.beginNew()).toBe(true);
    expect(entry.snapshot().status).toBe("editing");
  });
  it("rejects changed inputs during an in-flight request", async () => {
    const response = deferred<Transaction>();
    let calls = 0;
    const entry = new ManualEntry(
      async () => {
        calls++;
        return response.promise;
      },
      () => key,
    );
    const first = entry.submit(input);
    await expect(
      entry.submit({ ...input, amountKrw: 30000 }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    response.resolve(saved);
    await first;
  });
  it("copies and freezes input so caller mutations cannot change a retry", async () => {
    const request = {
      ...input,
      time: {
        occurredAt: stamp,
        precision: "minute" as const,
        sourceTimeZone: "Asia/Seoul",
      },
    };
    const requests: CreateTransactionInput[] = [];
    const entry = new ManualEntry(
      async (value) => {
        requests.push(value);
        throw new ClientError("NETWORK");
      },
      () => key,
    );
    await expect(entry.submit(request)).rejects.toThrow();
    request.time.sourceTimeZone = "UTC";
    await expect(entry.retry()).rejects.toThrow();
    expect(requests[1]!.time?.sourceTimeZone).toBe("Asia/Seoul");
    expect(Object.isFrozen(requests[1]!.time)).toBe(true);
  });
  it("disposes account-owned state and ignores late success", async () => {
    const response = deferred<Transaction>();
    const entry = new ManualEntry(
      async () => response.promise,
      () => key,
    );
    const pending = entry.submit(input);
    const check = expect(pending).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    entry.dispose();
    response.resolve(saved);
    await check;
    expect(entry.snapshot()).toEqual({ status: "disposed" });
    await expect(entry.retry()).rejects.toThrow();
    await expect(entry.submit(input)).rejects.toThrow();
  });
  it("rejects invalid input without a network call or attempt key", async () => {
    let calls = 0,
      keys = 0;
    const entry = new ManualEntry(
      async () => {
        calls++;
        return saved;
      },
      () => {
        keys++;
        return key;
      },
    );
    await expect(
      entry.submit({ ...input, amountKrw: 0 }),
    ).rejects.toMatchObject({ code: "LEDGER_VALIDATION_FAILED" });
    expect(calls).toBe(0);
    expect(keys).toBe(0);
  });
});
