import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SessionManager } from "../auth/session-manager";
import { secureStorage } from "../auth/secure-storage";
import { NotificationAccess } from "../collector/notification-access";
import { androidNotificationAccess } from "../platform/notification-access";
import { NotificationAccessGuide } from "./notification-access-guide";
import { colors, common } from "./theme";

/** @param manager 서버가 검증한 현재 계정. 백그라운드/계정 변경 시 상위 화면이 모델을 폐기한다. */
export function NotificationAccessPanel({
  manager,
}: {
  manager: SessionManager;
}) {
  const model = useMemo(
    () =>
      new NotificationAccess(
        () => manager.notificationConsentScope(),
        secureStorage,
        androidNotificationAccess,
      ),
    [manager],
  );
  const state = useSyncExternalStore(model.subscribe, model.snapshot);
  const [confirmation, setConfirmation] = useState<
    "accept" | "withdraw" | null
  >(null);
  useEffect(() => {
    void model.start();
    return () => model.stop();
  }, [model]);
  const ready = state.phase === "ready";
  const busy = ["idle", "loading", "saving"].includes(state.phase);
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        동의와 알림 접근
      </Text>
      <Text style={common.body}>
        동의 저장과 Android 권한 설정을 준비할 수 있어요. 현재 버전은 알림
        내용을 읽거나 거래로 저장하지 않아요.
      </Text>
      <View accessibilityLiveRegion="polite" style={styles.status}>
        <Text style={common.body}>
          이 기기의 동의:{" "}
          {ready
            ? state.consent
              ? "저장됨"
              : "동의하지 않음"
            : "확인 중 또는 확인 필요"}
        </Text>
        <Text style={common.body}>
          Android 알림 접근:{" "}
          {ready
            ? state.permission?.available
              ? state.permission.accessGranted
                ? "허용됨"
                : "허용되지 않음"
              : "새 개발 APK 설치 필요"
            : "확인 중 또는 확인 필요"}
        </Text>
        {ready && state.permission?.accessGranted ? (
          <Text style={common.secondary}>
            서비스 연결:{" "}
            {state.permission.listenerConnected
              ? "연결됨 — 자동 기록은 아직 사용하지 않아요"
              : "아직 연결되지 않음"}
          </Text>
        ) : null}
        {busy ? (
          <Text style={common.secondary}>
            {state.phase === "saving"
              ? "처리 중이에요…"
              : "현재 상태를 확인하고 있어요…"}
          </Text>
        ) : null}
      </View>
      {state.notice ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={state.phase === "error" ? "alert" : undefined}
          style={state.phase === "error" ? common.error : common.body}
        >
          {state.notice}
        </Text>
      ) : null}
      <NotificationAccessGuide />
      {confirmation ? (
        <View style={styles.confirmation}>
          <Text accessibilityRole="header" style={styles.title}>
            {confirmation === "accept"
              ? "알림 자동 기록 준비에 동의할까요? (선택)"
              : "이 휴대폰의 동의를 철회할까요?"}
          </Text>
          <Text style={common.body}>
            {confirmation === "accept"
              ? "향후 선택한 금융 앱·문자·카카오톡에서 새로 온 금융 알림을 기기 안에서 분석하고, 금액·방향·시각·거래 상대 등 필요한 정보를 내 서버 장부에 저장하기 위한 동의예요. 일반 대화·인증번호·광고는 제외하며 원문은 서버에 보내지 않아요."
              : "이 계정·설치에 저장된 동의를 지워요. 기존 거래는 삭제하지 않고, Android의 알림 접근 권한도 자동으로 해제되지는 않아요."}
          </Text>
          <Text style={common.secondary}>
            {confirmation === "accept"
              ? "거절해도 수기 장부를 사용할 수 있고 나중에 철회할 수 있어요. 지금은 동의 버전·시각·계정 및 설치 식별자만 기기의 보안 저장소에 보관해요. 서버 동의 검증과 출처 선택이 연결되기 전에는 자동 기록을 시작하지 않아요."
              : "철회 뒤에도 OS 접근이 켜져 있으면 아래 ‘Android 알림 접근 설정’에서 직접 꺼 주세요."}
          </Text>
          <Action
            label={
              confirmation === "accept"
                ? "동의하고 이 기기에 저장"
                : "동의 철회 확인"
            }
            disabled={!ready}
            onPress={() => {
              const action = confirmation;
              setConfirmation(null);
              void (action === "accept" ? model.accept() : model.withdraw());
            }}
          />
          <Action
            label="취소"
            secondary
            disabled={busy}
            onPress={() => setConfirmation(null)}
          />
        </View>
      ) : (
        <Action
          label={state.consent ? "동의 철회 안내" : "선택 동의 확인"}
          disabled={!ready || (!state.consent && !state.permission?.available)}
          onPress={() => setConfirmation(state.consent ? "withdraw" : "accept")}
        />
      )}
      <Action
        label="Android 알림 접근 설정"
        secondary
        disabled={
          !ready ||
          !state.permission?.available ||
          (!state.consent && !state.permission.accessGranted)
        }
        onPress={() => {
          void model.openSettings();
        }}
      />
      <Action
        label="동의·권한 상태 다시 확인"
        secondary
        disabled={busy}
        onPress={() => {
          void model.reload();
        }}
      />
      <Text style={common.secondary}>
        권한은 Android 설정에서 직접 선택해요. 설정에서 돌아오면 로그인 확인 후
        실제 권한을 다시 조회해요. 허용하지 않아도 수기 장부는 그대로 사용할 수
        있어요.
      </Text>
    </View>
  );
}

/** @param props 명시적인 확인/설정 동작과 비활성 상태. 최소 48dp 터치 영역을 제공한다. */
function Action({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        common.button,
        secondary && styles.secondary,
        (disabled || pressed) && styles.dimmed,
      ]}
    >
      <Text style={secondary ? common.link : common.buttonText}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  section: { gap: 16, paddingTop: 16 },
  title: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
  },
  status: { gap: 8 },
  confirmation: {
    gap: 12,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.outline,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  dimmed: { opacity: 0.5 },
});
