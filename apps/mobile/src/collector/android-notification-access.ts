import { z } from "zod";
import type { NotificationAccessPort } from "./notification-access";

export type NativePort = {
  getStatus(): Promise<unknown>;
  openSettings(): Promise<unknown>;
};
const Status = z
  .object({
    available: z.literal(true),
    accessGranted: z.boolean(),
    listenerConnected: z.boolean(),
  })
  .strict()
  .refine((value) => !value.listenerConnected || value.accessGranted);
/** @param native 현재 APK의 모듈. 이전 APK/Expo Go는 null이며 안전한 미지원 상태를 반환한다. */
export function createAndroidNotificationAccess(
  native: NativePort | null,
): NotificationAccessPort {
  return {
    getStatus: async () =>
      native
        ? Status.parse(await native.getStatus())
        : { available: false, accessGranted: false, listenerConnected: false },
    openSettings: async () =>
      native ? (await native.openSettings()) === true : false,
  };
}
