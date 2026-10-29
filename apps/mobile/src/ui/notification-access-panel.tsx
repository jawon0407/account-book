import { useSyncExternalStore } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AlertButton,
} from "react-native";
import type { NotificationAccess } from "../collector/notification-access";
import type { CollectorEnrollment } from "../collector/collector-enrollment";
import { consentPresentation } from "../collector/notification-consent-copy";
import { NotificationAccessGuide } from "./notification-access-guide";
import { colors, common } from "./theme";

/** @param model 동의/OS 접근의 현재 상태. @param enrollment 화면·계정 경계를 검증하는 동작 연결. 대표 기기 지정은 별도 화면 구역이 담당한다. */
export function NotificationAccessPanel({
  model,
  enrollment,
}: {
  model: NotificationAccess;
  enrollment: CollectorEnrollment;
}) {
  const state = useSyncExternalStore(model.subscribe, model.snapshot);
  const flow = useSyncExternalStore(enrollment.subscribe, enrollment.snapshot);
  const presentation = consentPresentation(state);
  const busy = presentation.busy || flow.busy;
  const action = presentation.primaryAction;

  /** 현재 상태에 맞는 확인 팝업만 연다. 팝업을 열거나 취소하는 것만으로는 저장하지 않는다. */
  function showAccessChoice() {
    const deny = enrollment.prepareWithdrawal();
    if (action === "deny" || action === "settings") {
      Alert.alert(
        action === "deny"
          ? "알림을 거부할까요?"
          : "Android 알림 접근을 확인해 주세요",
        (presentation.canWithdraw
          ? "이 휴대폰의 금융 알림 처리 동의를 철회해요. 대표 기기 지정과 기존 거래는 그대로 유지돼요."
          : "서버 동의 상태를 확인하지 못했어요. 동의 철회가 완료됐다고 표시하지 않으며, 휴대폰의 알림 접근은 직접 끌 수 있어요.") +
          "\n\nAndroid 접근이 켜져 있으면 다음 설정 화면에서 Account Book Dev를 직접 꺼 주세요. 앱에서 OS 권한을 자동으로 해제할 수는 없어요.",
        [
          { text: "취소", style: "cancel" },
          {
            text: action === "deny" ? "알림 거부" : "설정 열기",
            style: "destructive",
            onPress: () => {
              void deny();
            },
          },
        ],
        { cancelable: true },
      );
      return;
    }
    if (action !== "allow") return;
    const allow = enrollment.prepareAccessRequest();
    const buttons: AlertButton[] = [{ text: "취소", style: "cancel" }];
    // 별도 관리 버튼 없이도 철회 또는 OS 접근 해제를 이어갈 수 있다.
    if (presentation.alternateAction !== "none")
      buttons.push({
        text:
          presentation.alternateAction === "deny"
            ? "알림 거부"
            : "권한 해제 설정",
        style: "destructive",
        onPress: () => {
          void deny();
        },
      });
    buttons.push({
      text: presentation.canAccept ? "동의하고 계속" : "계속",
      onPress: () => {
        void allow();
      },
    });
    Alert.alert(
      "Account Book Dev 알림 접근",
      (presentation.canAccept
        ? "새 금융 앱·문자·카카오톡 알림을 기기에서 분석하고 필요한 거래 정보만 내 서버 장부에 저장하기 위한 선택 동의예요. 일반 대화·인증번호·광고와 과거 내역은 제외하며 원문은 서버에 보내지 않아요.\n\n동의 버전·시각·계정·설치 식별자를 서버에 보관해요. 거절해도 수기 장부를 이용할 수 있고 나중에 철회할 수 있어요."
        : "금융 알림 처리 동의는 이미 저장되어 있어요. Android 알림 접근이 꺼져 있으면 설정에서 직접 허용해 주세요.") +
        "\n\n현재는 실제 알림을 읽거나 기록하지 않아요. 알림 허용만으로 대표 기기를 지정하지 않아요. 대표 기기는 위의 ‘이 기기 지정’에서 별도로 설정해 주세요." +
        (presentation.canWithdraw
          ? "\n\n‘알림 거부’를 선택하면 서버 동의를 철회해요. 대표 기기 지정과 기존 거래는 유지하며, OS 접근이 켜져 있으면 설정에서 직접 꺼 주세요."
          : presentation.alternateAction === "settings"
            ? "\n\nAndroid 알림 접근은 아직 켜져 있어요. ‘권한 해제 설정’을 누르면 다시 동의하지 않고 설정에서 직접 끌 수 있어요."
            : ""),
      buttons,
      { cancelable: true },
    );
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        알림 설정
      </Text>
      <Text style={common.body}>
        휴대폰에 도착하는 금융 앱·카카오톡·문자 알림을 가계부에서 활용하려면
        Account Book의 알림 접근을 허용해 주세요.
      </Text>
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
      <View style={styles.permissionActions}>
        <View style={styles.actionColumn}>
          <NotificationAccessGuide />
        </View>
        <View style={styles.actionColumn}>
          <Action
            label={
              action === "deny"
                ? "알림 거부"
                : action === "settings"
                  ? "권한 확인"
                  : "알림 허용"
            }
            danger={action === "deny"}
            disabled={busy || action === "none"}
            onPress={showAccessChoice}
          />
        </View>
      </View>
      <Text style={common.secondary}>
        알림 허용과 대표 기기 지정은 별도예요. Android 권한은 설정에서 직접
        선택하며, 돌아오면 실제 상태를 다시 확인해요. 허용하지 않아도 수기
        장부는 사용할 수 있어요.
      </Text>
    </View>
  );
}

/** @param props 상태에서 정한 동작/위험 색상/비활성 여부. 보이는 면만 압축하고 48dp 조작 영역은 보존한다. */
function Action({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  danger: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.touchTarget}
    >
      {({ pressed }) => (
        <View
          style={[
            common.button,
            styles.compactButton,
            danger && styles.danger,
            (disabled || pressed) && styles.dimmed,
          ]}
        >
          <Text style={[common.buttonText, styles.buttonLabel]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  section: { gap: 16, paddingTop: 16 },
  permissionActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  actionColumn: { flex: 1, minWidth: 0 },
  touchTarget: { minHeight: 48, justifyContent: "center" },
  compactButton: { width: "100%", minHeight: 42, paddingVertical: 9 },
  danger: { backgroundColor: colors.error },
  buttonLabel: { textAlign: "center" },
  title: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
  },
  status: { gap: 8 },
  dimmed: { opacity: 0.5 },
});
