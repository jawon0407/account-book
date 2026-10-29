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
  it.each(["withdrawn", "not_granted"] as const)(
    "keeps a settings-only popup escape for %s with OS access still enabled",
    (state) => {
      expect(
        consentPresentation({
          ...ready,
          consent: { ...ready.consent!, state },
          permission: { ...ready.permission!, accessGranted: true },
        }),
      ).toMatchObject({ primaryAction: "allow", alternateAction: "settings" });
    },
  );
  it("offers no settings-only escape when access is already off", () => {
    expect(consentPresentation(ready).alternateAction).toBe("none");
  });
  it.each([
    ["granted", true, true, "deny"],
    ["granted", false, true, "allow"],
    ["withdrawn", true, true, "allow"],
    ["not_granted", false, true, "allow"],
    ["outdated", true, true, "allow"],
    ["granted", false, false, "deny"],
    ["not_granted", false, false, "none"],
  ] as const)(
    "selects a usable action for %s / OS=%s / native=%s",
    (state, accessGranted, available, primaryAction) => {
      expect(
        consentPresentation({
          ...ready,
          consent: { ...ready.consent!, state },
          permission: { ...ready.permission!, available, accessGranted },
        }).primaryAction,
      ).toBe(primaryAction);
    },
  );
  it("keeps a single-button OS escape when server consent cannot be read", () => {
    expect(
      consentPresentation({
        ...ready,
        phase: "error",
        consent: null,
        permission: { ...ready.permission!, accessGranted: true },
      }).primaryAction,
    ).toBe("settings");
  });
  it.each(["idle", "loading", "saving"] as const)(
    "has no action while %s",
    (phase) => {
      expect(consentPresentation({ ...ready, phase }).primaryAction).toBe(
        "none",
      );
    },
  );
  it.each([
    ["not_granted", true, "허용되지 않음"],
    ["withdrawn", true, "허용되지 않음"],
    ["outdated", true, "허용되지 않음"],
    ["granted", false, "허용되지 않음"],
    ["granted", true, "허용됨"],
  ] as const)(
    "combines %s consent and OS access=%s without changing actions",
    (state, accessGranted, allowanceLabel) => {
      expect(
        consentPresentation({
          ...ready,
          consent: { ...ready.consent!, state, version: 1 },
          permission: { ...ready.permission!, accessGranted },
        }).allowanceLabel,
      ).toBe(allowanceLabel);
    },
  );
  it.each(["idle", "loading", "saving"] as const)(
    "shows checking rather than an old allowance during %s",
    (phase) => {
      expect(consentPresentation({ ...ready, phase }).allowanceLabel).toBe(
        "확인 중",
      );
    },
  );
  it.each([
    { ...ready, phase: "error" as const },
    { ...ready, consent: null },
    { ...ready, permission: null },
    { ...ready, permission: { ...ready.permission!, available: false } },
  ])(
    "shows a known denial even when the other source is unavailable",
    (state) => {
      expect(consentPresentation(state).allowanceLabel).toBe("허용되지 않음");
    },
  );
  it.each([
    { ...ready, phase: "error" as const, consent: null, permission: null },
    {
      ...ready,
      consent: { ...ready.consent!, state: "granted" as const },
      permission: null,
    },
    {
      ...ready,
      consent: null,
      permission: { ...ready.permission!, accessGranted: true },
    },
  ])("keeps truly unknown combinations unknown", (state) => {
    expect(consentPresentation(state).allowanceLabel).toBe("확인 필요");
  });
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
