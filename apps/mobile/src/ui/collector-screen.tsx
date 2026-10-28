import { useEffect, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { CollectorEnrollment } from "../collector/collector-enrollment";
import { consentPresentation } from "../collector/notification-consent-copy";
import {
  COLLECTOR_PREPARATION,
  collectorConfirmationCopy,
  collectorStateCopy,
} from "../collector/collector-copy";
import { colors, common } from "./theme";
import { NotificationAccessPanel } from "./notification-access-panel";

/** @param enrollment OS 설정 왕복 의도를 관리하는 연결 모델. @param onBack 의도를 취소하고 장부로 돌아가는 동작. */
export function CollectorScreen({
  enrollment,
  onBack,
}: {
  enrollment: CollectorEnrollment;
  onBack: () => void;
}) {
  const { settings: model, access } = enrollment;
  const flow = useSyncExternalStore(enrollment.subscribe, enrollment.snapshot);
  const state = useSyncExternalStore(model.subscribe, model.snapshot);
  const accessState = useSyncExternalStore(access.subscribe, access.snapshot);
  useEffect(() => {
    void enrollment.start();
    return () => enrollment.stop();
  }, [enrollment]);
  const busy =
    state.phase === "idle" ||
    state.phase === "loading" ||
    state.phase === "saving";
  const refreshing = flow.busy || busy || consentPresentation(accessState).busy;
  const copy = state.value ? collectorStateCopy(state.value.state) : null;
  const confirmation = state.confirmation
    ? collectorConfirmationCopy(state.confirmation)
    : null;
  return (
    <ScrollView
      style={common.page}
      contentContainerStyle={[common.container, styles.content]}
    >
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          style={[common.textButton, styles.back]}
          onPress={onBack}
        >
          <Text style={common.link}>장부로 돌아가기</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="알림 설정 상태 새로고침"
          accessibilityHint="수집 기기, 동의와 Android 권한 상태를 다시 확인해요"
          accessibilityState={{
            disabled: refreshing,
          }}
          disabled={refreshing}
          onPress={() => {
            void enrollment.reload();
          }}
          style={({ pressed }) => [
            common.textButton,
            (refreshing || pressed) && styles.dimmed,
          ]}
        >
          <Text style={common.link}>새로고침</Text>
        </Pressable>
      </View>
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
              disabled={refreshing}
              onPress={() => {
                void enrollment.confirm();
              }}
            />
            <Action
              label="취소"
              secondary
              disabled={refreshing}
              onPress={() => enrollment.cancel()}
            />
          </View>
        ) : state.phase === "ready" && state.value ? (
          <View style={styles.actions}>
            {state.value.state !== "inactive" ? (
              <Action
                label="기기 지정 해제"
                secondary
                disabled={refreshing}
                onPress={() => model.choose("deactivate")}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      {flow.notice ? (
        <Text accessibilityLiveRegion="polite" style={common.body}>
          {flow.notice}
        </Text>
      ) : null}
      <Text style={common.secondary}>
        기기를 바꾸거나 지정을 해제해도 이미 저장한 거래는 유지돼요. 실제 알림을
        읽는 기능은 아직 준비 중이에요.
      </Text>
      <NotificationAccessPanel model={access} enrollment={enrollment} />
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
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
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
