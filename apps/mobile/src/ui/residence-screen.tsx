import { useState, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { LedgerTimeZoneSchema } from "@account-book/contracts";
import type { ManualWorkspace } from "../ledger/manual-workspace";
import { Action, Field, FormPage } from "./form-controls";
import { manualError } from "./manual-error";
import { common } from "./theme";

/** 여행 시각과 장부의 거주 기준을 구분하고, 사용자의 명시적 저장만 서버에 반영한다. */
export function ResidenceScreen({ workspace }: { workspace: ManualWorkspace }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const [zone, setZone] = useState(state.profile?.ledgerTimeZone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const parsed = LedgerTimeZoneSchema.safeParse(zone.trim());
    if (!parsed.success) {
      setError("지역 시간대를 확인해 주세요. 예: Asia/Seoul, America/New_York");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await workspace.setResidence(parsed.data);
    } catch (cause) {
      setError(manualError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormPage>
      <Action
        label="입력으로 돌아가기"
        secondary
        action={() => workspace.open("manual")}
      />
      <Text accessibilityRole="header" style={common.title}>
        장부 거주 기준
      </Text>
      <Text style={common.body}>
        평소 거주하는 지역의 시간대를 선택해 주세요.
      </Text>
      <Text style={common.secondary}>
        여행 때문에 바꿀 필요는 없어요. 거래 입력의 ‘시각의 시간대’에 현지
        지역을 지정하면 돼요. 거주 기준을 변경해도 과거 기록의 날짜는 다시
        계산하지 않아요.
      </Text>
      <Text style={common.secondary}>
        현재: {state.profile?.ledgerTimeZone ?? "아직 설정하지 않았어요"}
      </Text>
      <Field
        label="거주 지역 시간대"
        value={zone}
        onChangeText={setZone}
        autoCapitalize="none"
        editable={!busy}
        maxLength={80}
        placeholder="예: Asia/Seoul"
      />
      <Action
        label="한국 · Asia/Seoul 선택"
        secondary
        disabled={busy}
        action={() => setZone("Asia/Seoul")}
      />
      {state.draft?.sourceTimeZone ? (
        <Action
          label={`입력 화면의 시간대 · ${state.draft.sourceTimeZone}`}
          secondary
          disabled={busy}
          action={() => setZone(state.draft!.sourceTimeZone)}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={common.error}>
          {error}
        </Text>
      ) : null}
      <Action
        label={busy ? "설정 확인 중…" : "이 거주 기준으로 저장"}
        disabled={busy || state.loading || !state.profile}
        action={() => {
          void save();
        }}
      />
    </FormPage>
  );
}
