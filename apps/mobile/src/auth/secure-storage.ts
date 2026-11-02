import * as SecureStore from "expo-secure-store";
import type { SessionStorage } from "./session-manager";

const options = { keychainService: "account-book-native-v1" };
/** OS 저장 오류는 숨기지 않는다. manager가 차단·재로그인 정책을 결정한다. */
export const secureStorage: SessionStorage = {
  get: (key) => SecureStore.getItemAsync(key, options),
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  remove: (key) => SecureStore.deleteItemAsync(key, options),
};
