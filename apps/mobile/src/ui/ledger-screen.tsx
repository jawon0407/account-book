import { useEffect, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { Transaction } from "@account-book/contracts";
import type { SessionManager } from "../auth/session-manager";
import { errorMessage } from "../api/client-error";
import { transactionLabel, mergePage } from "./ledger-presentation";
import { colors, common } from "./theme";

/** @param manager 현재 계정 전용 session manager. 조회 결과는 이 화면의 메모리에만 둔다. */
export function LedgerScreen({
  manager,
  onCreate,
  onLoadStarted,
  onLoaded,
  notice,
  createLabel,
}: {
  manager: SessionManager;
  onCreate: () => void;
  onLoadStarted: () => object | null;
  onLoaded: (receipt: object | null) => void;
  notice: ReactNode;
  createLabel: string;
}) {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  async function load(next = false) {
    if (pending.current) return;
    const listReceipt = onLoadStarted();
    pending.current = true;
    setBusy(true);
    setError(null);
    if (!next) {
      setRows([]);
      setCursor(null);
    }
    try {
      const result = await manager.transactions(
        next ? (cursor ?? undefined) : undefined,
      );
      if (alive.current) {
        setRows((previous) =>
          next ? mergePage(previous, result.items) : result.items,
        );
        setCursor(result.nextCursor);
        onLoaded(listReceipt);
      }
    } catch (cause) {
      if (alive.current) setError(errorMessage(cause));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <View style={common.page}>
      <View style={[common.container, styles.header]}>
        <Text accessibilityRole="header" style={common.title}>
          거래 내역
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            style={common.button}
            onPress={onCreate}
          >
            <Text style={common.buttonText}>{createLabel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={common.textButton}
            disabled={busy}
            onPress={() => {
              void load();
            }}
          >
            <Text style={common.link}>새로고침</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={common.textButton}
            onPress={() => {
              void manager.signOut();
            }}
          >
            <Text style={common.link}>로그아웃</Text>
          </Pressable>
        </View>
        {notice}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={[common.container, styles.list]}
        refreshing={busy}
        onRefresh={() => {
          void load();
        }}
        ListHeaderComponent={
          error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={common.body}>
              {busy
                ? "거래 내역을 불러오고 있어요"
                : error
                  ? "조회가 완료되지 않았어요"
                  : "아직 기록된 거래가 없어요"}
            </Text>
            <Text style={common.secondary}>
              {busy
                ? "서버에서 현재 장부를 확인하고 있어요."
                : error
                  ? "새로고침을 눌러 다시 확인해 주세요."
                  : "PC와 같은 계정의 거래가 이곳에 표시돼요."}
            </Text>
          </View>
        }
        renderItem={({ item }) => <TransactionRow row={item} />}
        ListFooterComponent={
          cursor ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              style={[common.button, styles.more]}
              onPress={() => {
                void load(true);
              }}
            >
              <Text style={common.buttonText}>
                {busy ? "불러오는 중…" : "이전 거래 더 보기"}
              </Text>
            </Pressable>
          ) : undefined
        }
      />
    </View>
  );
}
/** @param row 서버의 한 거래. 미지정/미분류를 숨기거나 임의 카테고리로 대신하지 않는다. */
function TransactionRow({ row }: { row: Transaction }) {
  const label = transactionLabel(row);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${label.title}, ${label.detail}, ${label.amount}, ${label.unassigned}`}
    >
      <Text style={styles.name}>{label.title}</Text>
      <View style={styles.details}>
        <Text style={common.secondary}>{label.detail}</Text>
        <Text style={styles.amount}>{label.amount}</Text>
      </View>
      {label.unassigned ? (
        <Text style={styles.status}>{label.unassigned}</Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  header: { paddingTop: 16, paddingBottom: 16, gap: 8 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  },
  list: { paddingBottom: 24 },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.outline,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    marginBottom: 8,
  },
  name: { fontSize: 16, lineHeight: 24, color: colors.text },
  details: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  amount: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  status: { fontSize: 12, lineHeight: 18, color: colors.secondary },
  empty: { gap: 12, paddingVertical: 48 },
  error: { ...common.error, marginBottom: 16 },
  more: { marginTop: 16 },
});
