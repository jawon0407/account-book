import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

/** OS 안전 영역과 시스템 뒤로 가기를 Expo Router에 맡긴다. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
