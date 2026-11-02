import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, common } from "./theme";

const ENTER_MS = 220;

/** @param message 서버가 확인한 성공 문구. null이면 숨긴다. 종료 시점은 설정 모델이 소유한다. */
export function CollectorToast({ message }: { message: string | null }) {
  const [reduceMotion, setReduceMotion] = useState(true);
  const entrance = useRef(new Animated.Value(1)).current;
  const timeline = useRef<{ message: string; startedAt: number } | null>(null);

  // 토스트가 없을 때도 구독해, 성공 순간에는 시스템 모션 설정이 준비되도록 한다.
  useEffect(() => {
    let current = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        changed = true;
        if (current) setReduceMotion(enabled);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (current && !changed) setReduceMotion(enabled);
      })
      .catch(() => {
        /* 설정 조회 실패 시 움직임을 줄인 기본값을 유지한다. */
      });
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!message) {
      timeline.current = null;
      return;
    }
    if (timeline.current?.message !== message)
      timeline.current = { message, startedAt: performance.now() };
    const startedAt = timeline.current.startedAt;
    const elapsed = performance.now() - startedAt;
    entrance.setValue(reduceMotion ? 1 : Math.min(1, elapsed / ENTER_MS));

    if (!reduceMotion) {
      Animated.timing(entrance, {
        toValue: 1,
        duration: Math.max(0, ENTER_MS - elapsed),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
        isInteraction: false,
      }).start();
    }
    return () => {
      entrance.stopAnimation();
    };
  }, [message, reduceMotion, entrance]);

  if (!message) return null;
  return (
    <View pointerEvents="none" style={styles.anchor}>
      <Animated.View
        style={[
          styles.toast,
          {
            transform: [
              {
                translateY: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [24, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text
          accessibilityLiveRegion="polite"
          style={[common.body, styles.text]}
        >
          {message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    alignItems: "center",
  },
  toast: {
    maxWidth: "100%",
    backgroundColor: colors.text,
    borderRadius: common.button.borderRadius - 4,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  text: { color: colors.surface, textAlign: "center" },
});
