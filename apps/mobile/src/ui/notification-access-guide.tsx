import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, common } from "./theme";

/**
 * 알림 수집 전 필요한 선택과 권한을 설명한다. 외부 매개변수는 없다.
 * visible은 안내 팝업의 표시 여부일 뿐 동의·권한·수집 상태가 아니다.
 * 저장소나 서버를 호출하지 않으며 화면을 나가면 표시 상태도 폐기된다.
 */
export function NotificationAccessGuide() {
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="알림 접근 자세히 알아보기"
        accessibilityHint="설명 팝업을 열어요. 동의나 권한은 바뀌지 않아요"
        onPress={() => setVisible(true)}
        style={styles.touchTarget}
      >
        {({ pressed }) => (
          <View style={[styles.toggle, pressed && styles.pressed]}>
            <Text style={[common.link, styles.buttonLabel]}>
              자세히 알아보기
            </Text>
          </View>
        )}
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <SafeAreaView style={styles.backdrop}>
          <View style={styles.dialog} accessibilityViewIsModal>
            <View style={styles.header}>
              <Text accessibilityRole="header" style={styles.heading}>
                알림 접근 안내
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="알림 접근 안내 닫기"
                style={({ pressed }) => [
                  common.textButton,
                  pressed && styles.pressed,
                ]}
                onPress={() => setVisible(false)}
              >
                <Text style={common.link}>닫기</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.details}>
              <Text style={common.body}>
                안내를 읽는 것만으로는 동의하지 않아요. ‘알림 허용’ 팝업에서
                동의한 뒤 Android 설정에서 권한을 직접 선택해야 해요.
              </Text>
              <Text style={common.secondary}>
                자동 기록은 선택 사항이에요. 권한을 허용하지 않아도 수기로
                장부를 사용할 수 있어요.
              </Text>
              <Text style={common.secondary}>
                아래 내용은 앞으로 연결할 자동 기록 기능의 처리 기준이에요.
                현재는 동의 저장·권한 확인·수집 기기 지정까지만 제공하고, 알림
                분석·저장은 하지 않아요.
              </Text>
              <Section
                title="‘알림 여부’는 무엇을 뜻하나요?"
                paragraphs={[
                  "현재 계정으로 이 휴대폰의 금융 알림 처리에 동의하고 Android 알림 접근도 켰을 때 ‘허용됨’으로 표시해요. 동의나 권한 중 하나라도 없으면 ‘허용되지 않음’이에요. 상태를 조회하는 동안은 ‘확인 중’, 확인하지 못했을 때는 ‘확인 필요’로 표시해요.",
                  "‘허용됨’은 실제 자동 기록 중이라는 뜻은 아니에요. 수집 기기 지정과 실제 알림 처리 기능은 별도이며, 현재는 알림을 읽거나 기록하지 않아요.",
                ]}
              />
              <Section
                title="어떤 알림을 사용하나요?"
                paragraphs={[
                  "동의와 설정을 마친 뒤 새로 도착하는 금융 앱·문자·카카오톡 알림에서 금융 거래를 선별하는 방향으로 준비하고 있어요. 고정된 은행 목록을 고를 필요는 없으며, 과거 문자나 채팅 내역을 조회하지 않아요.",
                  "일반 대화·인증번호·광고는 기록 대상이 아니에요. 카드 승인 안내만으로 거래를 만들지 않고, 계좌의 입출금이 확인되는 내용을 사용해요.",
                  "알림 원문은 기기 메모리에서 판독한 뒤 버리고, 금액·거래 방향·상대명 등 필요한 거래 정보만 로그인한 계정의 서버 장부로 보내는 방식으로 준비하고 있어요.",
                ]}
              />
              <Section
                title="두 권한은 서로 달라요"
                paragraphs={[
                  "‘알림 접근’은 다른 앱의 알림을 읽는 권한이에요. Android가 금융 알림만 골라 허용하는 권한은 아니어서, 우리 앱이 금융 거래 내용인지 선별해야 해요. 모든 알림 형식을 정확히 분석할 수 있다는 뜻은 아니에요.",
                  "‘알림 표시’는 우리 앱이 미분류 거래 등의 안내를 휴대폰에 띄우는 권한이에요. 이를 허용해도 다른 앱의 알림을 읽을 수는 없어요. 표시를 거절해도 앱 안에서 확인할 수 있도록 준비해요.",
                ]}
              />
              <Section
                title="자동 기록은 언제 시작되나요?"
                paragraphs={[
                  "‘알림 허용’은 동의 저장과 Android 접근 확인만 처리해요. 대표 기기는 ‘이 기기 지정’에서 별도로 설정하며, 다른 기기가 지정되어 있으면 교체 여부를 확인해요. 권한 허용·앱 복귀·새로고침으로 기기가 자동 지정되지는 않아요. 다른 기기 로그인은 유지돼요.",
                  "계정에 지정된 수집 기기 1대에서만 동작하며, 실제 권한과 서비스 연결 상태도 확인해야 해요. 기기 지정만으로 모든 준비가 끝나는 것은 아니에요.",
                ]}
              />
              <Section
                title="원하지 않을 때는 멈출 수 있나요?"
                paragraphs={[
                  "허용 상태의 빨간 ‘알림 거부’에서 처리 동의를 철회할 수 있어요. Android 접근이 켜져 있으면 설정 화면에서 Account Book Dev를 직접 꺼 주세요. 대표 기기 지정과 이미 저장한 거래는 유지돼요. 앱은 OS 권한을 자동으로 끌 수 없으며, 서버 철회 결과가 불확실하면 완료로 표시하지 않아요.",
                  "동의만 남거나 고지가 바뀐 경우 ‘알림 허용’ 팝업 안의 ‘알림 거부’로 철회할 수 있어요. 서버를 확인하지 못했지만 OS 접근이 켜져 있다면 ‘권한 확인’에서 설정을 열 수 있어요. 실제 수집의 일시 중지는 후속 단계예요.",
                  "알림이 오지 않거나 내용이 숨겨진 경우, 지원하지 않는 형식은 자동 기록을 보장할 수 없어요. 빠진 거래는 직접 작성하고, 다시 켜도 중지 중의 알림을 소급 수집하지 않는 방식이에요.",
                ]}
              />
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

/** @param title 안내 주제. @param paragraphs 해당 주제의 짧은 설명 문단들. */
function Section({
  title,
  paragraphs,
}: {
  title: string;
  paragraphs: readonly string[];
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {paragraphs.map((paragraph) => (
        <Text key={paragraph} style={common.body}>
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  dialog: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "90%",
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  heading: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
    flexShrink: 1,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
  },
  // 작아진 버튼 표면과 별개로 누르는 영역은 최소 48dp다.
  touchTarget: { minHeight: 48, justifyContent: "center" },
  buttonLabel: { textAlign: "center" },
  toggle: {
    minHeight: 42,
    width: "100%",
    paddingVertical: 9,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.background },
  details: { gap: 24, padding: 16, paddingBottom: 24 },
  section: { gap: 12 },
});
