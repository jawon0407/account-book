import { useEffect, useSyncExternalStore } from "react";
import { BackHandler, KeyboardAvoidingView, Text } from "react-native";
import type { SessionManager } from "../auth/session-manager";
import type { ManualWorkspace } from "../ledger/manual-workspace";
import type { CollectorEnrollment } from "../collector/collector-enrollment";
import { LedgerScreen } from "./ledger-screen";
import { ManualEntryScreen } from "./manual-entry-screen";
import { ResidenceScreen } from "./residence-screen";
import { CollectorScreen } from "./collector-screen";
import { common } from "./theme";

/** 인증된 화면의 경로만 담당한다. 초안/저장 시도의 수명은 상위 workspace에 있다. */
export function LedgerFlow({
  manager,
  workspace,
  enrollment,
}: {
  manager: SessionManager;
  workspace: ManualWorkspace;
  enrollment: CollectorEnrollment;
}) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  useEffect(() => {
    void workspace.load();
  }, [workspace]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (state.screen === "ledger") return false;
        if (state.screen === "collector") enrollment.cancel();
        workspace.open(state.screen === "residence" ? "manual" : "ledger");
        return true;
      },
    );
    return () => subscription.remove();
  }, [state.screen, workspace, enrollment]);
  if (state.screen === "manual")
    return (
      <KeyboardAvoidingView style={common.page} behavior="height">
        <ManualEntryScreen workspace={workspace} />
      </KeyboardAvoidingView>
    );
  if (state.screen === "residence")
    return (
      <KeyboardAvoidingView style={common.page} behavior="height">
        <ResidenceScreen workspace={workspace} />
      </KeyboardAvoidingView>
    );
  if (state.screen === "collector")
    return (
      <CollectorScreen
        enrollment={enrollment}
        onBack={() => {
          enrollment.cancel();
          workspace.open("ledger");
        }}
      />
    );
  const status = state.entry?.snapshot().status;
  return (
    <LedgerScreen
      key={state.listVersion}
      manager={manager}
      onCreate={() => workspace.open("manual")}
      onCollector={() => workspace.open("collector")}
      onLoadStarted={() => workspace.beginListCheck()}
      onLoaded={(receipt) => workspace.markListChecked(receipt)}
      notice={
        <Text style={status === "uncertain" ? common.error : common.secondary}>
          {status === "uncertain"
            ? "저장 결과 확인이 필요한 기록이 있어요. 목록 확인 후 ‘입력 이어가기’에서 처리해 주세요."
            : status === "saving"
              ? "저장 확인 중이에요. 입력 화면에서 상태를 확인할 수 있어요."
              : status === "saved"
                ? "거래를 저장했어요. 아래 목록은 서버에서 다시 불러와요."
                : "이전에 저장 중 앱이 종료됐다면 새로 작성하기 전에 목록을 먼저 확인해 주세요."}
        </Text>
      }
      createLabel={
        state.draft?.amount && status !== "saved"
          ? "입력 이어가기"
          : "거래 직접 기록"
      }
    />
  );
}
