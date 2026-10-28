import { describe, expect, it } from "vitest";
import type { AccessState } from "./notification-access";
import { consentPresentation } from "./notification-consent-copy";
const ready: AccessState = {
  phase: "ready",
  consent: {
    state: "not_granted",
    version: 0,
    noticeVersion: "notification-access-v1",
  },
  permission: {
    available: true,
    accessGranted: false,
    listenerConnected: false,
  },
  notice: null,
};
describe("consent presentation action policy", () => {
  it.each([
    ["not_granted", true, false, false],
    ["withdrawn", true, false, false],
    ["granted", false, true, true],
    ["outdated", true, true, false],
  ] as const)(
    "derives %s without treating all objects as consent",
    (state, canAccept, canWithdraw, canOpenSettings) => {
      expect(
        consentPresentation({
          ...ready,
          consent: {
            ...ready.consent!,
            state,
            version: state === "not_granted" ? 0 : 1,
          },
        }),
      ).toMatchObject({ canAccept, canWithdraw, canOpenSettings, busy: false });
    },
  );
  it.each(["idle", "loading", "saving", "error"] as const)(
    "blocks unsafe actions during %s",
    (phase) => {
      expect(consentPresentation({ ...ready, phase })).toMatchObject({
        canAccept: false,
        canWithdraw: false,
        canOpenSettings: false,
      });
    },
  );
  it("permits OS removal in error state while server consent is unknown", () => {
    expect(
      consentPresentation({
        ...ready,
        phase: "error",
        consent: null,
        permission: { ...ready.permission!, accessGranted: true },
      }),
    ).toMatchObject({
      canAccept: false,
      canWithdraw: false,
      canOpenSettings: true,
    });
  });
  it("allows server withdrawal without native support, but not new consent", () => {
    expect(
      consentPresentation({
        ...ready,
        consent: { ...ready.consent!, state: "outdated", version: 1 },
        permission: null,
      }),
    ).toMatchObject({
      canAccept: false,
      canWithdraw: true,
      canOpenSettings: false,
    });
  });
});
