import { randomUUID } from "expo-crypto";
import { NativeClient } from "./api/native-client";
import { SessionManager } from "./auth/session-manager";
import { secureStorage } from "./auth/secure-storage";
import { androidTransport } from "./api/android-transport";

/** 빌드의 공개 origin만 읽는다. 비밀키나 DB 주소는 앱 번들에 포함하지 않는다. */
export function createRuntime(): SessionManager {
  return new SessionManager(
    new NativeClient(
      process.env.EXPO_PUBLIC_API_ORIGIN ?? "",
      androidTransport,
    ),
    secureStorage,
    randomUUID,
  );
}
