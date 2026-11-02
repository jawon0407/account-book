import { describe, expect, it, vi } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { NativeClient } from "./native-client";

const token = "A".repeat(43);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
describe("collector HTTP boundary", () => {
  it("reads and changes consent at the fixed bearer-only path", async () => {
    const requests: Request[] = [];
    const client = new NativeClient("https://ledger.example", async (raw) => {
      requests.push(new Request(raw));
      return json({
        version: 1,
        state: "granted",
        noticeVersion: "notification-access-v1",
      });
    });
    await client.collector.readConsent(token);
    await client.collector.changeConsent(token, {
      action: "accept",
      expectedVersion: 0,
      noticeVersion: "notification-access-v1",
    });
    expect(
      requests.map((r) => [
        r.url,
        r.method,
        r.credentials,
        r.redirect,
        r.headers.get("authorization"),
      ]),
    ).toEqual([
      [
        "https://ledger.example/api/native/collector/consent",
        "GET",
        "omit",
        "error",
        `Bearer ${token}`,
      ],
      [
        "https://ledger.example/api/native/collector/consent",
        "PATCH",
        "omit",
        "error",
        `Bearer ${token}`,
      ],
    ]);
    expect(await requests[1]!.json()).toEqual({
      action: "accept",
      expectedVersion: 0,
      noticeVersion: "notification-access-v1",
    });
  });
  it("rejects forged consent fields and unknown notices before HTTP", async () => {
    const transport = vi.fn();
    const client = new NativeClient("https://ledger.example", transport);
    for (const input of [
      { action: "withdraw", expectedVersion: 1, userId: "other" },
      { action: "accept", expectedVersion: 0, noticeVersion: "old" },
      { action: "withdraw", expectedVersion: -1 },
    ])
      await expect(
        client.collector.changeConsent(token, input as never),
      ).rejects.toMatchObject({ code: "COLLECTOR_VALIDATION_FAILED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { version: 0, state: "granted", noticeVersion: "notification-access-v1" },
    { version: 1, state: "granted", noticeVersion: "unknown" },
    {
      version: 1,
      state: "granted",
      noticeVersion: "notification-access-v1",
      userId: "private",
    },
  ])("rejects malformed consent response %j", async (body) => {
    const client = new NativeClient("https://ledger.example", async () =>
      json(body),
    );
    await expect(client.collector.readConsent(token)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("does not retry a failed consent withdrawal even when the server suggests retry", async () => {
    const transport = vi.fn(async () =>
      json(
        buildApiError({
          code: "COLLECTOR_SERVICE_UNAVAILABLE",
          retryable: true,
        }),
        503,
      ),
    );
    const client = new NativeClient("https://ledger.example", transport);
    await expect(
      client.collector.changeConsent(token, {
        action: "withdraw",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("uses fixed GET/PATCH with bearer, no cookies and exact expected version", async () => {
    const requests: Request[] = [];
    const client = new NativeClient("https://ledger.example", async (raw) => {
      const request = new Request(raw);
      requests.push(request);
      return json({ version: 2, state: "active_here" });
    });
    await client.collector.read(token);
    await client.collector.change(token, {
      action: "activate",
      expectedVersion: 1,
      replaceExisting: true,
    });
    expect(
      requests.map((r) => [r.url, r.method, r.credentials, r.redirect]),
    ).toEqual([
      ["https://ledger.example/api/native/collector", "GET", "omit", "error"],
      ["https://ledger.example/api/native/collector", "PATCH", "omit", "error"],
    ]);
    expect(
      requests.every(
        (r) => r.headers.get("authorization") === `Bearer ${token}`,
      ),
    ).toBe(true);
    expect(await requests[1]!.json()).toEqual({
      action: "activate",
      expectedVersion: 1,
      replaceExisting: true,
    });
  });
  it("rejects owner injection and a missing replacement decision before sending", async () => {
    const transport = vi.fn();
    const client = new NativeClient("https://ledger.example", transport);
    for (const input of [
      { action: "activate", expectedVersion: 1 },
      { action: "deactivate", expectedVersion: 1, userId: "other" },
      { action: "deactivate", expectedVersion: -1 },
    ])
      await expect(
        client.collector.change(token, input as never),
      ).rejects.toMatchObject({ code: "COLLECTOR_VALIDATION_FAILED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { version: 0, state: "active_here" },
    { version: 1, state: "active_here", deviceId: "secret" },
  ])("rejects malformed success %j", async (body) => {
    const client = new NativeClient("https://ledger.example", async () =>
      json(body),
    );
    await expect(client.collector.read(token)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("never replays an uncertain change", async () => {
    const transport = vi.fn(async () =>
      json(
        buildApiError({
          code: "COLLECTOR_SERVICE_UNAVAILABLE",
          retryable: true,
        }),
        503,
      ),
    );
    const client = new NativeClient("https://ledger.example", transport);
    await expect(
      client.collector.change(token, {
        action: "deactivate",
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
