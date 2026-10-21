import { useState } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, common } from "./theme";

/** @param onSubmit 이메일/비밀번호를 메모리에서만 전달한다. @param error 고정 안전 문구. */
export function LoginScreen({
  onSubmit,
  error,
}: {
  onSubmit(email: string, password: string): Promise<void>;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  async function submit() {
    if (pending) return;
    setPending(true);
    try {
      await onSubmit(email.trim(), password);
    } finally {
      setPassword("");
      setPending(false);
    }
  }
  return (
    <KeyboardAvoidingView style={styles.page} behavior="padding">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
      >
        <View style={[common.container, styles.form]}>
          <Text accessibilityRole="header" style={common.title}>
            내 장부에 로그인
          </Text>
          <Text style={common.secondary}>
            PC에서 사용하던 계정으로{"\n"}같은 장부를 이어서 확인하세요.
          </Text>
          <View style={styles.field}>
            <Text style={common.body}>이메일</Text>
            <TextInput
              accessibilityLabel="이메일"
              style={common.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              maxLength={254}
              editable={!pending}
            />
          </View>
          <View style={styles.field}>
            <Text style={common.body}>비밀번호</Text>
            <TextInput
              accessibilityLabel="비밀번호"
              style={common.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              maxLength={128}
              editable={!pending}
              onSubmitEditing={() => {
                void submit();
              }}
            />
          </View>
          {error ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={common.error}
            >
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending }}
            disabled={pending}
            style={[common.button, pending && styles.disabled]}
            onPress={() => {
              void submit();
            }}
          >
            <Text style={common.buttonText}>
              {pending ? "로그인 확인 중…" : "로그인"}
            </Text>
          </Pressable>
          <Text style={common.secondary}>
            처음 사용하시나요? 현재 개발 버전은 웹에서 가입한 이메일 계정으로
            로그인할 수 있어요.
          </Text>
          <Text style={common.secondary}>
            앱을 다시 열면 로그인 상태를 안전하게 확인해요. 세션이 만료되면 다시
            로그인해 주세요.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  scroll: { flexGrow: 1, justifyContent: "center", paddingVertical: 40 },
  form: { gap: 24 },
  field: { gap: 8 },
  disabled: { opacity: 0.6 },
});
