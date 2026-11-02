import { describe, expect, it, vi } from "vitest";
import {
  LedgerTimeEvidenceSchema,
  ResidenceTimeHistorySchema,
  buildTimedLedgerTime,
  preserveDateOnlyLedgerTime,
  selectResidenceTimeZone,
} from "./ledger-time.js";

const minute = {
  occurredAt: "2026-10-16T15:53:00.000Z",
  precision: "minute" as const,
  source: "user" as const,
  sourceTimeZone: "UTC",
};
const history = [
  { effectiveFrom: null, timeZone: "Asia/Seoul" },
  { effectiveFrom: "2026-11-01T00:00:00.000Z", timeZone: "America/Los_Angeles" },
];

describe("ledger time evidence", () => {
  it("preserves an old DATE without inventing an instant or timezone", () => {
    expect(preserveDateOnlyLedgerTime("2024-02-29")).toEqual({
      occurredOn: "2024-02-29", occurredAt: null, precision: "day",
      source: "legacy_date", sourceTimeZone: null, ledgerTimeZone: null,
    });
    expect(() => preserveDateOnlyLedgerTime("2026-02-29")).toThrow();
  });

  it("keeps source time zone separate from the residence calendar", () => {
    expect(buildTimedLedgerTime(minute, "Asia/Seoul")).toEqual({
      ...minute, occurredOn: "2026-10-17", ledgerTimeZone: "Asia/Seoul",
    });
    expect(buildTimedLedgerTime(minute, "America/Los_Angeles").occurredOn).toBe("2026-10-16");
  });

  it.each([
    ["2026-01-31T15:00:00.000Z", "Asia/Seoul", "2026-02-01"],
    ["2026-01-01T00:00:00.000Z", "America/Los_Angeles", "2025-12-31"],
    ["2026-10-16T18:15:00.000Z", "Asia/Kathmandu", "2026-10-17"],
    ["2026-03-08T06:59:00.000Z", "America/New_York", "2026-03-08"],
    ["2026-03-08T07:00:00.000Z", "America/New_York", "2026-03-08"],
  ])("converts %s in %s to %s", (occurredAt, zone, day) => {
    expect(buildTimedLedgerTime({ ...minute, occurredAt }, zone).occurredOn).toBe(day);
  });

  it("does not collapse two real UTC instants in the repeated DST hour", () => {
    const a = buildTimedLedgerTime({ ...minute, occurredAt: "2026-11-01T05:30:00.000Z" }, "America/New_York");
    const b = buildTimedLedgerTime({ ...minute, occurredAt: "2026-11-01T06:30:00.000Z" }, "America/New_York");
    expect(a.occurredAt).not.toBe(b.occurredAt);
    expect(a.occurredOn).toBe(b.occurredOn);
  });

  it.each(["+09:00", "KST", "EST", "", "Asia/Unknown", " Asia/Seoul ", "x".repeat(129)])("rejects invalid residence zone %j", zone => {
    expect(() => buildTimedLedgerTime(minute, zone)).toThrow();
  });

  it("rejects bad source zones and unsupported keys instead of silently stripping them", () => {
    expect(() => buildTimedLedgerTime({ ...minute, sourceTimeZone: "KST" }, "UTC")).toThrow();
    expect(() => buildTimedLedgerTime({ ...minute, userId: "untrusted" }, "UTC")).toThrow();
  });

  it.each([
    "2026-10-16T15:53:30.000Z", "2026-10-16T15:53:00.001Z",
    "2026-10-16T15:53:00+00:00", "2026-10-16T15:53:00Z",
    "2026-02-30T15:53:00.000Z", "2026-10-16T15:53:00.000",
    "2026-10-16T15:53:60.000Z", "0000-01-01T00:00:00.000Z",
  ])("rejects invalid/noncanonical minute evidence %s", occurredAt => {
    expect(() => buildTimedLedgerTime({ ...minute, occurredAt }, "UTC")).toThrow();
  });

  it("does not discard seconds/milliseconds from higher precision evidence", () => {
    expect(buildTimedLedgerTime({ ...minute, precision: "second", occurredAt: "2026-10-16T15:53:42.000Z" }, "UTC").occurredAt).toBe("2026-10-16T15:53:42.000Z");
    expect(() => buildTimedLedgerTime({ ...minute, precision: "second", occurredAt: "2026-10-16T15:53:42.001Z" }, "UTC")).toThrow();
    expect(buildTimedLedgerTime({ ...minute, precision: "millisecond", occurredAt: "2026-10-16T15:53:42.123Z" }, "UTC").occurredAt).toBe("2026-10-16T15:53:42.123Z");
  });

  it("retains received-time estimation and never promotes it to a notification time", () => {
    expect(buildTimedLedgerTime({ ...minute, source: "device_received", sourceTimeZone: null }, "Asia/Seoul").source).toBe("device_received");
  });

  it("validates stored snapshot shape and date against its own recorded zone", () => {
    const value = buildTimedLedgerTime(minute, "Asia/Seoul");
    expect(LedgerTimeEvidenceSchema.parse(value)).toEqual(value);
    expect(() => LedgerTimeEvidenceSchema.parse({ ...value, occurredOn: "2026-10-16" })).toThrow();
    expect(() => LedgerTimeEvidenceSchema.parse({ ...value, precision: "day" })).toThrow();
    expect(() => LedgerTimeEvidenceSchema.parse({ ...value, source: "legacy_date" })).toThrow();
    expect(() => LedgerTimeEvidenceSchema.parse({ ...value, ledgerTimeZone: null })).toThrow();
  });

  it("does not use the host default timezone", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu";
      const a = buildTimedLedgerTime(minute, "Asia/Seoul");
      process.env.TZ = "Europe/London";
      expect(buildTimedLedgerTime(minute, "Asia/Seoul")).toEqual(a);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

describe("residence timezone history", () => {
  it.each([
    ["2026-10-31T23:59:00.000Z", "Asia/Seoul"],
    ["2026-11-01T00:00:00.000Z", "America/Los_Angeles"],
    ["2026-11-02T00:00:00.000Z", "America/Los_Angeles"],
  ])("selects by occurrence %s, not delivery date", (occurredAt, timeZone) => {
    expect(selectResidenceTimeZone({ ...minute, occurredAt }, history)).toEqual({ status: "resolved", timeZone });
  });

  it("flags a minute straddling a move, but accepts the exact start/end boundaries", () => {
    const changes = [history[0], { effectiveFrom: "2026-10-16T15:53:30.000Z", timeZone: "UTC" }];
    expect(selectResidenceTimeZone(minute, changes)).toEqual({ status: "confirmation_required", reason: "precision_crosses_change" });
    expect(selectResidenceTimeZone({ ...minute, occurredAt: "2026-10-16T15:52:00.000Z" }, changes)).toEqual({ status: "resolved", timeZone: "Asia/Seoul" });
    expect(selectResidenceTimeZone({ ...minute, precision: "second", occurredAt: "2026-10-16T15:53:30.000Z" }, changes)).toEqual({ status: "resolved", timeZone: "UTC" });
  });

  it("does not assign a relocated user's estimated received time as a confirmed occurrence", () => {
    const estimated = { ...minute, source: "device_received" };
    expect(selectResidenceTimeZone(estimated, history)).toEqual({ status: "confirmation_required", reason: "estimated_time" });
    expect(selectResidenceTimeZone(estimated, [history[0]])).toEqual({ status: "resolved", timeZone: "Asia/Seoul" });
  });

  it.each([
    [], [history[1]], [history[0], history[0]], [history[0], history[1], history[1]],
    [history[0], history[1], { effectiveFrom: "2026-10-01T00:00:00.000Z", timeZone: "UTC" }],
    [{ ...history[0], userId: "untrusted" }], Array.from({ length: 257 }, () => history[0]),
  ])("rejects missing/duplicate/out-of-order/unbounded history %#", input => {
    expect(ResidenceTimeHistorySchema.safeParse(input).success).toBe(false);
  });

  it("cannot choose residence for a date-only record by inventing midnight", () => {
    expect(() => selectResidenceTimeZone(preserveDateOnlyLedgerTime("2026-10-16"), history)).toThrow();
  });

  it("accepts 256 ordered entries and rejects 257 before any per-entry zone work", () => {
    const entries = Array.from({ length: 257 }, (_, index) => ({
      effectiveFrom: index === 0 ? null : new Date(Date.UTC(2000, 0, index)).toISOString(),
      timeZone: "UTC",
    }));
    expect(ResidenceTimeHistorySchema.safeParse(entries.slice(0, 256)).success).toBe(true);
    const formatter = vi.spyOn(Intl, "DateTimeFormat");
    try {
      expect(ResidenceTimeHistorySchema.safeParse(entries).success).toBe(false);
      expect(formatter.mock.calls.length).toBe(0);
    } finally { formatter.mockRestore(); }
  });
});
