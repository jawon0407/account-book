import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
import { createRuntime } from "../src/app-runtime";
import type { SessionManager } from "../src/auth/session-manager";
import { errorMessage } from "../src/api/client-error";
import { LoginScreen } from "../src/ui/login-screen";
import { LedgerFlow } from "../src/ui/ledger-flow";
import { ManualWorkspace } from "../src/ledger/manual-workspace";
import { common } from "../src/ui/theme";

/** 설정 오류도 앱 크래시 대신 안전한 안내로 보여 준다. 임의 서버 주소 입력 UI는 없다. */
export default function Index() {
  const [runtime] = useState(() => {
    try {
      return { manager: createRuntime(), error: null };
    } catch (error) {
      return { manager: null, error: errorMessage(error) };
    }
  });
  return (
    <SafeAreaView style={common.page}>
      {runtime.manager ? (
        <SessionApp manager={runtime.manager} />
      ) : (
        <View style={[common.container, { paddingVertical: 32 }]}>
          <Text accessibilityRole="header" style={common.title}>
            앱 설정 확인
          </Text>
          <Text style={common.error}>{runtime.error}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/** background에서는 화면/목록을 비우고 같은 계정의 수기 초안만 메모리에 보존한다. */
function SessionApp({ manager }: { manager: SessionManager }) {
  const state = useSyncExternalStore(manager.subscribe, manager.snapshot);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [error, setError] = useState<string | null>(null);
  const [workspace] = useState(
    () =>
      new ManualWorkspace(
        manager,
        randomUUID,
        () => {
          const now = new Date();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        },
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
      ),
  );
  useEffect(() => {
    const sync = () => workspace.acceptSession(manager.snapshot());
    sync();
    const unsubscribe = manager.subscribe(sync);
    void manager.restore();
    const listener = AppState.addEventListener("change", (next) => {
      setActive(next === "active");
      if (
        next === "active" &&
        ["ready", "verifying", "unavailable"].includes(
          manager.snapshot().status,
        )
      ) {
        void manager
          .revalidate()
          .catch((cause) => setError(errorMessage(cause)));
      }
    });
    return () => {
      listener.remove();
      unsubscribe();
      workspace.dispose();
    };
  }, [manager, workspace]);
  if (!active)
    return (
      <View style={common.container}>
        <Text style={common.title}>Account Book</Text>
      </View>
    );
  if (state.status === "ready")
    return (
      <LedgerFlow key={state.userId} manager={manager} workspace={workspace} />
    );
  if (state.status === "signed_out")
    return (
      <LoginScreen
        error={error}
        onSubmit={async (email, password) => {
          setError(null);
          try {
            await manager.signIn(email, password);
          } catch (cause) {
            setError(errorMessage(cause));
          }
        }}
      />
    );
  const recoverable =
    state.status === "storage_error" || state.status === "unavailable";
  return (
    <View style={[common.container, { paddingVertical: 40, gap: 24 }]}>
      <Text style={common.title}>
        {recoverable ? "로그인 상태를 확인해 주세요" : "로그인 상태 확인 중…"}
      </Text>
      {recoverable ? (
        <>
          <Text accessibilityRole="alert" style={common.error}>
            {state.status === "storage_error"
              ? "보안 저장소를 확인하거나 정리하지 못했어요. 로그아웃도 완료되지 않았을 수 있어요. 새 로그인 전에 다시 정리해 주세요."
              : "서버에 연결하지 못했어요. 이전 장부는 표시하지 않아요."}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={common.button}
            onPress={() => {
              void (
                state.status === "storage_error"
                  ? manager.signOut()
                  : manager.revalidate()
              ).catch((cause) => setError(errorMessage(cause)));
            }}
          >
            <Text style={common.buttonText}>
              {state.status === "storage_error"
                ? "저장소 다시 정리"
                : "다시 연결"}
            </Text>
          </Pressable>
          {state.status === "unavailable" ? (
            <Pressable
              accessibilityRole="button"
              style={common.button}
              onPress={() => {
                setError(null);
                void manager
                  .signOut()
                  .catch((cause) => setError(errorMessage(cause)));
              }}
            >
              <Text style={common.buttonText}>이 기기에서 로그아웃</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
