import { z } from "zod";

const Preview = z.object({
  direction: z.enum(["income", "expense"]), amount: z.number().int().min(1).max(999999999999),
  counterparty: z.string().min(1).max(80), accountHint: z.string().max(26).regex(/^[\d*-]+$/),
  localTime: z.string().regex(/^\d{2}\/\d{2} \d{2}:\d{2}$/), receivedAt: z.number().int().positive(),
  timeNeedsReview: z.literal(true),
}).strict();
export const CaptureSnapshotSchema = z.object({ running: z.boolean(), parsed: z.number().int().min(0).max(256),
  unrecognized: z.number().int().min(0).max(256), last: Preview.nullable() }).strict();
export type CaptureSnapshot = z.infer<typeof CaptureSnapshotSchema>;
export interface CapturePort {
  begin(): Promise<number>; beginVerification(epoch: number): Promise<number>;
  renew(epoch: number, ticket: number): Promise<boolean>;
  stop(): Promise<void>; snapshot(): Promise<CaptureSnapshot>;
}
export type NativeCapture = {
  beginCapture(): Promise<unknown>; beginCaptureVerification(epoch: number): Promise<unknown>;
  renewCapture(epoch: number, ticket: number): Promise<unknown>;
  stopCapture(): Promise<unknown>; captureSnapshot(): Promise<unknown>;
};
/** 구 APK/잘못된 bridge 응답은 수집 가능 상태로 승격하지 않는다. */
export function createAndroidCapture(module: NativeCapture | null): CapturePort {
  const requireModule = () => {
    if (!module || typeof module.beginCapture !== "function" || typeof module.beginCaptureVerification !== "function" || typeof module.renewCapture !== "function"
      || typeof module.stopCapture !== "function" || typeof module.captureSnapshot !== "function") throw new Error("CAPTURE_UNAVAILABLE");
    return module;
  };
  return {
    begin: async () => z.number().int().min(0).max(2147483647).parse(await requireModule().beginCapture()),
    beginVerification: async epoch => z.number().int().min(1).max(2147483647).parse(await requireModule().beginCaptureVerification(epoch)),
    renew: async (epoch, ticket) => (await requireModule().renewCapture(epoch, ticket)) === true,
    stop: async () => { if (module && typeof module.stopCapture === "function") await module.stopCapture(); },
    snapshot: async () => CaptureSnapshotSchema.parse(await requireModule().captureSnapshot()),
  };
}
