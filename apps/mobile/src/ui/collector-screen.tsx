import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { SessionManager } from "../auth/session-manager";
import { CollectorSettings } from "../collector/collector-settings";
import {
  COLLECTOR_PREPARATION,
  collectorConfirmationCopy,
  collectorStateCopy,
} from "../collector/collector-copy";
import { colors, common } from "./theme";
import { NotificationAccessGuide } from "./notification-access-guide";

/** @param manager 현재 인증 경계. @param onBack 초안을 보존한 채 장부로 돌아가는 동작. */
export function CollectorScreen({
  manager,
  onBack,
}: {
  manager: SessionManager;
  onBack: () => void;
}) {
  const model = useMemo(() => new CollectorSettings(manager), [manager]);
  const state = useSyncExternalStore(model.subscribe, model.snapshot);
  useEffect(() => {
    void model.start();
    return () => model.stop();
  }, [model]);
  const busy =
    state.phase === "idle" ||
    state.phase === "loading" ||
    state.phase === "saving";
  const copy = state.value ? collectorStateCopy(state.value.state) : null;
  const confirmation = state.confirmation
    ? collectorConfirmationCopy(state.confirmation)
    : null;
  return (
    <ScrollView
      style={common.page}
      contentContainerStyle={[common.container, styles.content]}
    >
      <Pressable
        accessibilityRole="button"
        style={[common.textButton, styles.back]}
        onPress={onBack}
      >
        <Text style={common.link}>장부로 돌아가기</Text>
      </Pressable>
      <Text accessibilityRole="header" style={common.title}>
        알림 수집 설정
      </Text>
      <View style={styles.introduction}>
        <Text style={styles.sectionTitle}>자동 기록 준비 중</Text>
        <Text style={common.body}>{COLLECTOR_PREPARATION}</Text>
      </View>
      <View style={styles.section}>
        <Text style={common.secondary}>수집 기기 지정</Text>
        {copy ? (
          <>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {copy.title}
            </Text>
            <Text style={common.body}>{copy.body}</Text>
          </>
        ) : (
          <Text style={common.body}>
            {state.phase === "error"
              ? "현재 상태를 확인하지 못했어요"
              : "기기 지정을 확인하고 있어요"}
          </Text>
        )}
        {busy ? (
          <View style={styles.loading} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.primary} />
            <Text style={common.secondary}>
              {state.phase === "saving"
                ? "서버에 저장하고 있어요…"
                : "서버에서 확인하고 있어요…"}
            </Text>
          </View>
        ) : null}
        {state.notice ? (
          <Text
            accessibilityRole={state.phase === "error" ? "alert" : undefined}
            accessibilityLiveRegion="polite"
            style={state.phase === "error" ? common.error : common.body}
          >
            {state.notice}
          </Text>
        ) : null}
        {confirmation ? (
          <View style={styles.confirmation} accessibilityLiveRegion="polite">
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {confirmation.title}
            </Text>
            <Text style={common.body}>{confirmation.body}</Text>
            <Action
              label={confirmation.confirmLabel}
              onPress={() => {
                void model.confirm();
              }}
            />
            <Action label="취소" secondary onPress={() => model.cancel()} />
          </View>
        ) : state.phase === "ready" && state.value ? (
          <View style={styles.actions}>
            {state.value.state !== "active_here" ? (
              <Action
                label={
                  state.value.state === "active_elsewhere"
                    ? "이 기기로 변경"
                    : "이 기기 지정"
                }
                onPress={() => model.choose("activate")}
              />
            ) : null}
            {state.value.state !== "inactive" ? (
              <Action
                label="기기 지정 해제"
                secondary
                onPress={() => model.choose("deactivate")}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      <Action
        label={state.phase === "error" ? "다시 조회" : "지정 상태 새로고침"}
        secondary
        disabled={busy}
        onPress={() => {
          void model.reload();
        }}
      />
      <Text style={common.secondary}>
        기기를 바꾸거나 지정을 해제해도 이미 저장한 거래는 유지돼요. 실제 알림을
        읽는 기능은 아직 준비 중이에요.
      </Text>
      <NotificationAccessGuide />
    </ScrollView>
  );
}

/** @param props 동작명/콜백과 보조·비활성 상태. Android 최소 터치 영역과 읽을 수 있는 상태를 유지한다. */
function Action({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        common.button,
        secondary && styles.secondaryButton,
        (disabled || pressed) && styles.dimmed,
      ]}
    >
      <Text style={secondary ? common.link : common.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 8, paddingBottom: 32, gap: 16 },
  back: { alignSelf: "flex-start", paddingHorizontal: 0 },
  introduction: { gap: 8 },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
  },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  actions: { gap: 8, marginTop: 4 },
  confirmation: {
    gap: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.outline,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  dimmed: { opacity: 0.5 },
});
