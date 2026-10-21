import { requireOptionalNativeModule } from "expo";
import {
  createAndroidNotificationAccess,
  type NativePort,
} from "../collector/android-notification-access";

// Expo를 순수 상태 모델과 분리한다. 예전 APK에는 이 모듈이 없으므로 안전한 미지원 상태로 시작한다.
export const androidNotificationAccess = createAndroidNotificationAccess(
  requireOptionalNativeModule<NativePort>("AccountBookNotificationAccess"),
);
