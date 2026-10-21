import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, common } from "./theme";

/**
 * 알림 수집 전 필요한 선택과 권한을 설명한다. 외부 매개변수는 없다.
 * expanded는 이 화면에서 설명을 펼치는 값일 뿐 동의·권한·수집 상태가 아니다.
 * 저장소나 서버를 호출하지 않으며 화면을 나가면 표시 상태도 폐기된다.
 */
export function NotificationAccessGuide() {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.guide}>
      <Text accessibilityRole="header" style={styles.title}>
        알림 접근 전 알아두세요
      </Text>
      <Text style={common.body}>
        안내를 읽거나 기기를 지정하는 것만으로는 동의하지 않아요. 아래에서
        동의를 따로 저장하고 Android 설정에서 권한을 직접 선택해야 해요.
      </Text>
      <Text style={common.secondary}>
        자동 기록은 선택 사항이에요. 권한을 허용하지 않아도 수기로 장부를 사용할
        수 있어요.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
      >
        <Text style={common.link}>
          {expanded ? "동의·권한 안내 접기" : "동의·권한 안내 보기"}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.details}>
          <Text style={common.secondary}>
            아래 내용은 앞으로 연결할 자동 기록 기능의 처리 기준이에요. 현재는
            동의 저장과 권한 설정까지만 제공하고, 알림 분석·저장은 하지 않아요.
          </Text>
          <Section
            title="어떤 알림을 사용하나요?"
            paragraphs={[
              "동의와 설정을 마친 뒤 새로 도착하는 알림 중, 사용자가 선택한 금융 앱·문자·카카오톡의 지원되는 금융 알림을 분석해요. 과거 문자나 채팅 내역을 조회하지 않아요.",
              "일반 대화·인증번호·광고는 기록 대상이 아니에요. 카드 승인 안내만으로 거래를 만들지 않고, 계좌의 입출금이 확인되는 내용을 사용해요.",
              "알림 원문은 기기 메모리에서 판독한 뒤 버리고, 금액·거래 방향·상대명 등 필요한 거래 정보만 로그인한 계정의 서버 장부로 보내는 방식으로 준비하고 있어요.",
            ]}
          />
          <Section
            title="두 권한은 서로 달라요"
            paragraphs={[
              "‘알림 접근’은 다른 앱의 알림을 읽는 권한이에요. Android가 금융 알림만 골라 허용하는 권한은 아니어서, 우리 앱에서 선택한 출처와 지원 형식을 선별해야 해요.",
              "‘알림 표시’는 우리 앱이 미분류 거래 등의 안내를 휴대폰에 띄우는 권한이에요. 이를 허용해도 다른 앱의 알림을 읽을 수는 없어요. 표시를 거절해도 앱 안에서 확인할 수 있도록 준비해요.",
            ]}
          />
          <Section
            title="자동 기록은 언제 시작되나요?"
            paragraphs={[
              "기능이 준비되면 처리 내용을 확인하고 동의한 뒤, Android 설정에서 알림 접근을 직접 허용하게 돼요. 이어 수집할 앱을 고르고 자동 기록을 켜야 해요.",
              "계정에 지정된 수집 기기 1대에서만 동작하며, 실제 권한과 서비스 연결 상태도 확인해야 해요. 기기 지정만으로 모든 준비가 끝나는 것은 아니에요.",
            ]}
          />
          <Section
            title="원하지 않을 때는 멈출 수 있나요?"
            paragraphs={[
              "이 화면에서 기기에 저장한 동의를 철회하고, Android 설정에서 알림 접근을 해제할 수 있어요. 실제 수집의 일시 중지·서버 동의 관리는 후속 단계예요. 중지·철회와 이미 저장한 거래의 삭제는 별개예요.",
              "알림이 오지 않거나 내용이 숨겨진 경우, 지원하지 않는 형식은 자동 기록을 보장할 수 없어요. 빠진 거래는 직접 작성하고, 다시 켜도 중지 중의 알림을 소급 수집하지 않는 방식이에요.",
            ]}
          />
        </View>
      ) : null}
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
  guide: { gap: 12, paddingTop: 16 },
  title: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
  },
  toggle: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.background },
  details: { gap: 24 },
  section: { gap: 12 },
});
