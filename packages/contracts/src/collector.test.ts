import { describe, expect, it } from "vitest";
import { CollectorChangeInputSchema, CollectorStateSchema } from "./collector.js";

describe("collector public contract", () => {
  it.each([
    { action: "activate", expectedVersion: 0, replaceExisting: false },
    { action: "activate", expectedVersion: 2147483647, replaceExisting: true },
    { action: "deactivate", expectedVersion: 1 },
  ])("accepts explicit action %j", input => { expect(CollectorChangeInputSchema.parse(input)).toEqual(input); });
  it.each([{}, { action: "activate", expectedVersion: 0 }, { action: "activate", expectedVersion: 0, replaceExisting: "true" },
    { action: "deactivate", expectedVersion: 1, replaceExisting: true }, { action: "other", expectedVersion: 1 },
    ...[-1, 0.5, 2147483648, "1", null, NaN, Infinity].map(expectedVersion => ({ action: "deactivate", expectedVersion })),
    ...["userId", "sessionId", "deviceId"].map(field => ({ action: "deactivate", expectedVersion: 1, [field]: "private" })),
  ])("rejects ambiguous/protected input %j", input => { expect(CollectorChangeInputSchema.safeParse(input).success).toBe(false); });
  it.each([{ version: 0, state: "inactive" }, { version: 1, state: "active_here" }, { version: 2, state: "active_elsewhere" }])("accepts safe state %j", state => {
    expect(CollectorStateSchema.parse(state)).toEqual(state);
  });
  it.each([{ version: 0, state: "active_here" }, { version: -1, state: "inactive" }, { version: 1, state: "unknown" },
    { version: 1, state: "active_here", sessionId: "private" }, { version: "1", state: "inactive" }])("rejects invalid/leaking output %j", state => {
    expect(CollectorStateSchema.safeParse(state).success).toBe(false);
  });
});
