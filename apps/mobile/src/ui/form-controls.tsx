import { useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { common, colors } from "./theme";

/** 이름·상태가 접근성 트리에도 전달되는 기본 입력. 금융 원문을 로그로 출력하지 않는다. */
export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={common.body}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        style={[common.input, props.style]}
        autoCorrect={false}
        autoComplete="off"
      />
      {hint ? <Text style={common.secondary}>{hint}</Text> : null}
    </View>
  );
}
/** @param action 동작. disabled/busy를 화면과 스크린리더에 함께 표시한다. */
export function Action({
  label,
  action,
  disabled = false,
  secondary = false,
}: {
  label: string;
  action: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={action}
      style={[
        secondary ? common.textButton : common.button,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <Text style={secondary ? common.link : common.buttonText}>{label}</Text>
    </Pressable>
  );
}
type Option = { id: string | null; name: string };
/** 단일 선택 모달. 긴 목록은 가상화하고 Android Back으로 닫을 수 있다. */
export function ChoiceField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  options: Option[];
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected =
    options.find((option) => option.id === value)?.name ??
    "사용할 수 없는 항목 — 다시 선택";
  return (
    <View style={{ gap: 8 }}>
      <Text style={common.body}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${selected}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[common.input, { justifyContent: "center" }]}
      >
        <Text style={common.body}>{selected}</Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="none"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={common.page}>
          <View
            style={[common.container, { flex: 1, paddingTop: 16, gap: 16 }]}
          >
            <Text accessibilityRole="header" style={common.title}>
              {label}
            </Text>
            <FlatList
              data={options}
              keyExtractor={(option) => option.id ?? "none"}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: item.id === value }}
                  onPress={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  style={{
                    minHeight: 56,
                    padding: 16,
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor:
                      item.id === value ? colors.primary : colors.outline,
                    borderRadius: 8,
                    backgroundColor: colors.surface,
                  }}
                >
                  <Text style={common.body}>
                    {item.id === value ? "✓ " : ""}
                    {item.name}
                  </Text>
                </Pressable>
              )}
            />
            <Action label="닫기" secondary action={() => setOpen(false)} />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

/** 키보드를 열어도 입력·저장 버튼까지 스크롤할 수 있는 공통 틀이다. */
export function FormPage({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        common.container,
        { paddingTop: 16, paddingBottom: 40, gap: 24 },
      ]}
    >
      {children}
    </ScrollView>
  );
}
