import { StyleSheet } from "react-native";

// Bookify 4032:961/4008:848에서 추출. Android 폰트·48dp 터치 영역으로 조정한다.
export const colors = {
  background: "#F5F6FA",
  surface: "#FFFFFF",
  primary: "#2B46F9",
  text: "#000000",
  secondary: "#6A6B82",
  outline: "#DFDFDF",
  error: "#C60600",
  warningSurface: "#FEDCDB",
} as const;
export const common = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  container: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 16,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
  },
  body: { color: colors.text, fontSize: 16, lineHeight: 24 },
  secondary: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: colors.surface,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
  },
  textButton: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  link: {
    color: colors.primary,
    fontSize: 14,
    lineHeight: 24,
    fontWeight: "600",
  },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.outline,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: colors.error, fontSize: 14, lineHeight: 22 },
});
