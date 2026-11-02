import { describe, expect, it } from "vitest";
import { NotificationConsentChangeInputSchema as Input, NotificationConsentStateSchema as State } from "./notification-consent.js";

describe("server notification consent contract", () => {
  it("accepts explicit current notice and withdrawal without client identity/time", () => {
    expect(Input.parse({ action: "accept", expectedVersion: 0, noticeVersion: "notification-access-v1" }).action).toBe("accept");
    expect(Input.parse({ action: "withdraw", expectedVersion: 1 }).action).toBe("withdraw");
  });
  it.each([
    { action: "accept", expectedVersion: 0 },
    { action: "accept", expectedVersion: 0, noticeVersion: "old" },
    { action: "withdraw", expectedVersion: -1 },
    { action: "withdraw", expectedVersion: 2147483648 },
    { action: "withdraw", expectedVersion: 1, userId: "attacker" },
    { action: "withdraw", expectedVersion: 1, deviceId: "attacker" },
    { action: "withdraw", expectedVersion: 1, acceptedAt: "2026-10-21" },
    { action: "withdraw", expectedVersion: 1, noticeVersion: "notification-access-v1" },
  ])("rejects malformed, stale notice or injected fields: %j", value => expect(Input.safeParse(value).success).toBe(false));
  it("requires consistent generation and exposes no installation identity", () => {
    const base = { version: 0, state: "not_granted", noticeVersion: "notification-access-v1" };
    expect(State.parse(base)).toEqual(base);
    for (const state of ["granted", "withdrawn", "outdated"]) {
      expect(State.safeParse({ ...base, state }).success).toBe(false);
      expect(State.safeParse({ ...base, state, version: 1 }).success).toBe(true);
    }
    expect(State.safeParse({ ...base, version: 1 }).success).toBe(false);
    expect(State.safeParse({ ...base, deviceId: "secret" }).success).toBe(false);
  });
});
