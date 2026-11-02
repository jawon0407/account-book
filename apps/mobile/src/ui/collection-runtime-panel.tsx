import { useSyncExternalStore } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { CollectionRuntime } from "../collector/collection-runtime";
import { colors, common } from "./theme";

/** 허용 여부와 실행 여부를 분리한다. 원문/거래 저장 성공으로 오해할 표현은 쓰지 않는다. */
export function CollectionRuntimePanel({ model, disabled }: { model: CollectionRuntime; disabled: boolean }) {
  const state = useSyncExternalStore(model.subscribe, model.snapshot);
  const stopping = state.phase === "stopping";
  const active = state.phase === "running" || state.phase === "checking" || stopping;
  const buttonDisabled = stopping || (disabled && !active);
  const last = state.result?.last;
  function start() {
    const confirm = model.prepareStart();
    Alert.alert("새 알림 판독을 시작할까요?", "이 설정 화면이 열려 있는 동안 새로 도착한 KB 입출금 알림의 지원 형식을 기기 메모리에서 분석해요. 최신 판독 결과만 임시로 표시하고 원문·결과를 서버나 파일에 저장하지 않아요.\n\n다른 앱으로 이동하거나 화면을 닫으면 중지돼요. 미지원 금융 앱·문자·카카오톡 형식은 아직 판독하지 않으며, 자동 장부 저장도 하지 않아요. 실제 금융 알림이 도착하면 그 내용도 판독 대상이 될 수 있어요.", [
      { text: "취소", style: "cancel" }, { text: "판독 시작", onPress: () => { void confirm(); } },
    ]);
  }
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>알림 판독 확인</Text>
    <Text style={common.body}>상태: {state.phase === "running" ? "이 화면에서 판독 중" : state.phase === "checking" ? "시작 조건 확인 중" : stopping ? "중지 확인 중" : state.phase === "error" ? "확인 필요" : "중지됨"}</Text>
    <Text style={common.secondary}>설정 화면 전용 확인 단계예요. 자동 저장·백그라운드 상시 수집은 아직 지원하지 않아요. 중지 중의 알림은 다시 가져오지 않아요.</Text>
    {state.notice ? <Text accessibilityRole="alert" style={common.error}>{state.notice}</Text> : null}
    {state.result ? <Text style={common.body}>판독 {state.result.parsed}건 · 형식 확인 필요 {state.result.unrecognized}건</Text> : null}
    {last ? <View style={styles.preview}>
      <Text style={common.body}>{last.direction === "income" ? "입금" : "출금"} {last.amount.toLocaleString("ko-KR")}원 · {last.counterparty}</Text>
      <Text style={common.secondary}>{last.accountHint} · 알림에 적힌 시각 {last.localTime}</Text>
      <Text style={common.secondary}>연도·시간대·계좌 연결은 확정 전이에요. 장부에 저장하지 않았어요.</Text>
    </View> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: buttonDisabled }}
      disabled={buttonDisabled} onPress={active ? () => { void model.stop(); } : start}
      style={[common.button, active && styles.stop, buttonDisabled && styles.dimmed]}>
      <Text style={common.buttonText}>{stopping ? "중지 확인 중" : active ? "판독 중지" : "판독 시작"}</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12, paddingTop: 24 },
  title: { color: colors.text, fontSize: 18, lineHeight: 26, fontWeight: "600" },
  preview: { gap: 8 }, stop: { backgroundColor: colors.error }, dimmed: { opacity: 0.5 } });
