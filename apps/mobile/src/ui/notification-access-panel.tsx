import { useState, useSyncExternalStore } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { NotificationAccess } from "../collector/notification-access";
import type { CollectorEnrollment } from "../collector/collector-enrollment";
import { consentPresentation } from "../collector/notification-consent-copy";
import { NotificationAccessGuide } from "./notification-access-guide";
import { colors, common } from "./theme";

/** @param model 상위 화면이 수명을 관리하는 동의·권한 모델. 이 패널은 표시와 사용자 선택만 담당한다. */
export function NotificationAccessPanel({
  model,
  enrollment,
}: {
  model: NotificationAccess;
  enrollment: CollectorEnrollment;
}) {
  const state = useSyncExternalStore(model.subscribe, model.snapshot);
  const flow = useSyncExternalStore(enrollment.subscribe, enrollment.snapshot);
  const collector = useSyncExternalStore(
    enrollment.settings.subscribe,
    enrollment.settings.snapshot,
  );
  const [confirmWithdrawal, setConfirmWithdrawal] = useState(false);
  const presentation = consentPresentation(state);
  const busy = presentation.busy || flow.busy;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        동의와 알림 접근
      </Text>
      <View style={styles.introduction}>
        <Text style={[common.body, styles.introductionText]}>
          알림 허용을 누르면 안내 팝업이 열려요. 특정 은행 목록을 고를 필요는
          없어요. 동의·권한 확인 후 수집 기기를 지정해요. 현재는 알림을 읽거나
          기록하지 않아요.
        </Text>
        <NotificationAccessGuide />
      </View>
      <View accessibilityLiveRegion="polite" style={styles.status}>
        <Text style={common.body}>
          알림 여부: {presentation.allowanceLabel}
        </Text>
        {state.permission && !state.permission.available ? (
          <Text style={common.secondary}>새 개발 APK 설치가 필요해요.</Text>
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
      <Action
        label="알림 허용"
        disabled={
          busy ||
          collector.phase !== "ready" ||
          !!collector.confirmation ||
          (!presentation.canAccept &&
            !(
              state.consent?.state === "granted" && presentation.canOpenSettings
            ))
        }
        onPress={() => {
          const needsConsent = presentation.canAccept;
          const confirmAccess = enrollment.prepareAccessRequest();
          Alert.alert(
            "Account Book Dev 알림 접근",
            (needsConsent
              ? "새 금융 앱·문자·카카오톡 알림을 기기에서 분석하고 필요한 거래 정보만 내 서버 장부에 저장하기 위한 선택 동의예요. 일반 대화·인증번호·광고와 과거 내역은 제외하며 원문은 서버에 보내지 않아요.\n\n동의 버전·시각·계정·설치 식별자를 서버에 보관해요. 거절해도 수기 장부를 이용할 수 있고 나중에 철회할 수 있어요.\n\n현재는 실제 알림을 읽거나 기록하지 않아요. 다음 Android 화면에서 Account Book Dev를 선택해 직접 허용해 주세요."
              : "금융 알림 처리 동의는 이미 저장되어 있어요. Android 알림 접근이 꺼져 있으면 설정에서 직접 허용해 주세요. 현재는 실제 알림을 읽거나 기록하지 않아요.") +
              "\n\n동의와 Android 접근을 확인하면 이 휴대폰을 수집 기기로 지정해요. 다른 기기가 지정되어 있으면 변경 여부를 다시 물어요. 여러 기기 로그인은 그대로 유지돼요.",
            [
              { text: "취소", style: "cancel" },
              {
                text: needsConsent ? "동의하고 계속" : "계속",
                onPress: () => {
                  void confirmAccess();
                },
              },
            ],
            { cancelable: true },
          );
        }}
      />
      {confirmWithdrawal ? (
        <View style={styles.confirmation}>
          <Text accessibilityRole="header" style={styles.title}>
            현재 계정·설치의 동의를 철회할까요?
          </Text>
          <Text style={common.body}>
            서버에 저장된 현재 계정·설치의 동의를 철회 상태로 바꿔요. 기존
            거래는 삭제하지 않고 Android 알림 접근도 자동으로 해제되지는 않아요.
          </Text>
          <Text style={common.secondary}>
            OS 접근이 켜져 있으면 ‘Android 알림 접근 관리’에서 직접 꺼 주세요.
          </Text>
          <Action
            label="동의 철회 확인"
            disabled={busy || !presentation.canWithdraw}
            onPress={() => {
              setConfirmWithdrawal(false);
              void enrollment.withdraw();
            }}
          />
          <Action
            label="취소"
            secondary
            disabled={busy}
            onPress={() => setConfirmWithdrawal(false)}
          />
        </View>
      ) : state.consent?.state === "granted" ||
        state.consent?.state === "outdated" ? (
        <Action
          label="동의 철회 안내"
          secondary
          disabled={busy || !presentation.canWithdraw}
          onPress={() => setConfirmWithdrawal(true)}
        />
      ) : null}
      {state.permission?.accessGranted ? (
        <Action
          label="Android 알림 접근 관리"
          secondary
          disabled={busy || !presentation.canOpenSettings}
          onPress={() => {
            enrollment.cancel();
            void model.openSettings();
          }}
        />
      ) : null}
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
  introduction: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 8,
  },
  introductionText: { flexBasis: 280, flexGrow: 1, flexShrink: 1 },
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
