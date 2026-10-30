import { describe, expect, it } from "vitest";
import { resolveManualClock } from "./manual-time";

describe("explicit local clock conversion", () => {
  it("converts Seoul minutes without using the device zone", () => {
    expect(resolveManualClock("2026-10-16", "15:53", "Asia/Seoul")).toEqual({
      status: "resolved",
      time: {
        occurredAt: "2026-10-16T06:53:00.000Z",
        precision: "minute",
        sourceTimeZone: "Asia/Seoul",
      },
    });
  });
  it("supports a quarter-hour zone offset", () => {
    expect(
      resolveManualClock("2026-10-16", "09:00", "Asia/Kathmandu"),
    ).toMatchObject({
      status: "resolved",
      time: { occurredAt: "2026-10-16T03:15:00.000Z" },
    });
  });
  it("rejects a nonexistent daylight-saving clock time", () => {
    expect(() =>
      resolveManualClock("2026-03-08", "02:30", "America/New_York"),
    ).toThrow("TIME_DOES_NOT_EXIST");
  });
  it("requires explicit choice for repeated clock time", () => {
    expect(
      resolveManualClock("2026-11-01", "01:30", "America/New_York"),
    ).toEqual({
      status: "ambiguous",
      options: [
        {
          choice: "earlier",
          offset: "-04:00",
          occurredAt: "2026-11-01T05:30:00.000Z",
        },
        {
          choice: "later",
          offset: "-05:00",
          occurredAt: "2026-11-01T06:30:00.000Z",
        },
      ],
    });
    expect(
      resolveManualClock("2026-11-01", "01:30", "America/New_York", "later"),
    ).toMatchObject({
      status: "resolved",
      time: { occurredAt: "2026-11-01T06:30:00.000Z" },
    });
  });
  it.each([
    ["2026-02-30", "12:00", "UTC"],
    ["2026-10-16", "24:00", "UTC"],
    ["2026-10-16", "12:00:01", "UTC"],
    ["2026-10-16", "12:00", "+09:00"],
  ])("rejects invalid date/clock/zone %s %s %s", (date, clock, zone) => {
    expect(() => resolveManualClock(date, clock, zone)).toThrow();
  });
  it("does not invent seconds for historical second-offset zones", () => {
    expect(() =>
      resolveManualClock("1900-01-01", "12:00", "Europe/Paris"),
    ).toThrow("TIME_PRECISION_UNSUPPORTED");
  });
});
