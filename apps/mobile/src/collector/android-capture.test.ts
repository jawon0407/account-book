import { describe, expect, it } from "vitest";
import { createAndroidCapture } from "./android-capture";
describe("capture native boundary", () => {
  it("refuses an older APK without capture methods", async () => {
    const port = createAndroidCapture(null);
    await expect(port.begin()).rejects.toThrow("CAPTURE_UNAVAILABLE");
    await expect(port.stop()).resolves.toBeUndefined();
  });
  it("rejects malformed snapshots and unexpected raw content", async () => {
    const port = createAndroidCapture({ beginCapture: async () => 1, beginCaptureVerification: async () => 1, renewCapture: async () => true,
      stopCapture: async () => undefined,
      captureSnapshot: async () => ({ running: true, parsed: 1, unrecognized: 0, last: null, rawText: "private" }),
    });
    await expect(port.snapshot()).rejects.toThrow();
  });
});
