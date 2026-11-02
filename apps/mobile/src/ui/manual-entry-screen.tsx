import { useState, useSyncExternalStore } from "react";
import { Alert, Text, View } from "react-native";
import type { ManualWorkspace } from "../ledger/manual-workspace";
import { ClientError } from "../api/client-error";
import { Action, FormPage } from "./form-controls";
import { ManualEntryFields } from "./manual-entry-fields";
import { manualError } from "./manual-error";
import { common } from "./theme";

/** 수기 입력 UI. 중복 방지·계정 소유권은 화면 밖 workspace/entry가 유지한다. */
export function ManualEntryScreen({
  workspace,
}: {
  workspace: ManualWorkspace;
}) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const [error, setError] = useState<string | null>(null);
  const entryState = state.entry?.snapshot();
  if (!state.draft || !entryState) return null;
  const locked = !["editing", "failed"].includes(entryState.status);
  async function save(retry = false) {
    setError(null);
    try {
      await (retry ? workspace.retry() : workspace.submit());
    } catch (cause) {
      if (
        cause instanceof ClientError &&
        cause.code === "LEDGER_TIME_REVIEW_REQUIRED"
      )
        workspace.edit({ historicalLedgerTimeZone: "" });
      setError(manualError(cause));
    }
  }
  return (
    <FormPage>
      <View style={{ gap: 8 }}>
        <Action
          label="거래 목록으로"
          secondary
          action={() => workspace.open("ledger")}
        />
        <Text accessibilityRole="header" style={common.title}>
          거래 직접 기록
        </Text>
        <Text style={common.secondary}>
          계좌와 카테고리는 나중에 정해도 돼요. 미지정 거래도 합계에 포함돼요.
        </Text>
      </View>
      {entryState.status === "saving" ? (
        <Text accessibilityLiveRegion="polite" style={common.body}>
          저장 확인 중… 다시 누르지 않아도 돼요.
        </Text>
      ) : null}
      {entryState.status === "uncertain" ? (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="alert" style={common.error}>
            저장됐을 수도 있지만 응답을 확인하지 못했어요. 같은 내용으로 다시
            확인하거나 목록을 먼저 확인해 주세요.
          </Text>
          <Action
            label="같은 요청으로 저장 확인"
            action={() => {
              void save(true);
            }}
          />
          <Action
            label="목록 확인하기"
            secondary
            action={() => workspace.open("ledger")}
          />
          {state.listChecked ? (
            <Action
              label="목록을 확인했어요 — 새로 작성"
              secondary
              action={() =>
                Alert.alert(
                  "중복 기록 주의",
                  "목록의 이전 거래까지 확인해 주세요. 이미 저장된 거래를 새로 작성하면 중복 기록됩니다. 그래도 새 입력을 시작할까요?",
                  [
                    { text: "취소", style: "cancel" },
                    {
                      text: "새 입력 시작",
                      onPress: () => {
                        workspace.resetAfterListCheck();
                        setError(null);
                      },
                    },
                  ],
                )
              }
            />
          ) : null}
        </View>
      ) : null}
      {state.loading ? (
        <Text style={common.secondary}>선택 자료를 불러오는 중…</Text>
      ) : null}
      {state.error ? (
        <Text accessibilityRole="alert" style={common.error}>
          {manualError(new ClientError(state.error))}
        </Text>
      ) : null}
      <Action
        label="선택 목록 새로 불러오기"
        secondary
        disabled={state.loading || locked}
        action={() => {
          void workspace.load();
        }}
      />
      <Text style={common.secondary}>
        장부 거주 기준: {state.context?.ledgerTimeZone ?? "미설정"}
      </Text>
      <Action
        label="거주 기준 설정"
        secondary
        disabled={locked || !state.profile || state.loading}
        action={() => workspace.open("residence")}
      />
      <ManualEntryFields
        draft={state.draft}
        context={
          state.context ?? {
            accounts: [],
            categories: [],
            ledgerTimeZone: null,
          }
        }
        locked={locked || !state.context}
        edit={(patch) => {
          workspace.edit(patch);
          setError(null);
        }}
      />
      {error ? (
        <Text accessibilityRole="alert" style={common.error}>
          {error}
        </Text>
      ) : entryState.status === "failed" ? (
        <Text accessibilityRole="alert" style={common.error}>
          {manualError(new ClientError(entryState.error))}
        </Text>
      ) : null}
      {!locked ? (
        <Action
          label="거래 저장"
          disabled={!state.context || state.loading}
          action={() => {
            void save();
          }}
        />
      ) : null}
      <Text style={common.secondary}>
        앱을 완전히 종료하면 작성 중인 내용은 지워져요. 저장 중 종료했다면 다시
        작성하기 전에 거래 목록을 먼저 확인해 주세요.
      </Text>
    </FormPage>
  );
}
