import { describe, expect, it } from "vitest";
import { createAndroidNotificationAccess } from "./android-notification-access";

describe("Android permission bridge", () => {
  it("supports an older APK without crashing or inventing permission", async () => {
    const androidNotificationAccess = createAndroidNotificationAccess(null);
    expect(await androidNotificationAccess.getStatus()).toEqual({
      available: false,
      accessGranted: false,
      listenerConnected: false,
    });
    expect(await androidNotificationAccess.openSettings()).toBe(false);
  });
  it("returns verified OS booleans and delegates only explicit settings navigation", async () => {
    let opens = 0;
    const port = createAndroidNotificationAccess({
      getStatus: async () => ({
        available: true,
        accessGranted: true,
        listenerConnected: false,
      }),
      openSettings: async () => {
        opens++;
        return true;
      },
    });
    expect(await port.getStatus()).toEqual({
      available: true,
      accessGranted: true,
      listenerConnected: false,
    });
    expect(opens).toBe(0);
    expect(await port.openSettings()).toBe(true);
    expect(opens).toBe(1);
  });
  it.each([
    {},
    { available: true, accessGranted: "true", listenerConnected: false },
    { available: true, accessGranted: false, listenerConnected: true },
  ])("rejects invalid OS status %j", async (value) => {
    const port = createAndroidNotificationAccess({
      getStatus: async () => value,
      openSettings: async () => false,
    });
    await expect(port.getStatus()).rejects.toThrow();
  });
  it("does not treat a non-boolean settings response as success", async () => {
    const port = createAndroidNotificationAccess({
      getStatus: async () => null,
      openSettings: async () => "true",
    });
    expect(await port.openSettings()).toBe(false);
  });
});
