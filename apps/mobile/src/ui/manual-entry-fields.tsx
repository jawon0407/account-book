import { Text, View } from "react-native";
import type { ManualDraft, ManualContext } from "../ledger/manual-input";
import {
  resolveManualClock,
  type ClockResolution,
} from "../ledger/manual-time";
import { Action, ChoiceField, Field } from "./form-controls";
import { common } from "./theme";

/** @param draft 메모리 초안. @param context 현재 계정의 선택 자료. 실제 저장은 상위 화면만 수행한다. */
export function ManualEntryFields({
  draft,
  context,
  locked,
  edit,
}: {
  draft: ManualDraft;
  context: ManualContext;
  locked: boolean;
  edit: (patch: Partial<ManualDraft>) => void;
}) {
  let clock: ClockResolution | null = null;
  if (draft.clock) {
    try {
      clock = resolveManualClock(draft.date, draft.clock, draft.sourceTimeZone);
    } catch {
      /* 정정 안내는 저장 시 표시한다. */
    }
  }
  return (
    <>
      <ChoiceField
        label="거래 방향"
        value={draft.type}
        disabled={locked}
        options={[
          { id: "expense", name: "지출" },
          { id: "income", name: "수입" },
        ]}
        onChange={(value) =>
          edit({ type: value === "income" ? "income" : "expense" })
        }
      />
      <Field
        label="금액 (원)"
        value={draft.amount}
        onChangeText={(amount) => edit({ amount })}
        keyboardType="number-pad"
        maxLength={22}
        editable={!locked}
        placeholder="예: 20,000"
      />
      <Field
        label="거래 날짜"
        value={draft.date}
        onChangeText={(date) => edit({ date })}
        maxLength={10}
        editable={!locked}
        placeholder="YYYY-MM-DD"
        hint="시각을 모르면 날짜만 기록해도 돼요."
      />
      <Field
        label="거래 시각 (선택)"
        value={draft.clock}
        onChangeText={(value) => edit({ clock: value })}
        maxLength={5}
        editable={!locked}
        placeholder="예: 15:53"
      />
      {draft.clock ? (
        <>
          {draft.historicalLedgerTimeZone === undefined ? (
            <Action
              label="이사 전 거래의 장부 기준 지정"
              secondary
              disabled={locked}
              action={() => edit({ historicalLedgerTimeZone: "" })}
            />
          ) : (
            <Field
              label="거래 당시 장부 거주 시간대 (선택)"
              value={draft.historicalLedgerTimeZone}
              autoCapitalize="none"
              maxLength={80}
              editable={!locked}
              onChangeText={(historicalLedgerTimeZone) =>
                edit({ historicalLedgerTimeZone })
              }
              placeholder="예: Asia/Seoul"
              hint="거주 기준을 바꾸기 전의 거래라면 당시 기준을 입력하세요. 비워 두면 현재 기준을 사용해요. 거래 시각은 바뀌지 않으며 실제 저장 날짜는 서버의 거주 이력으로 검증해요."
            />
          )}
          <Field
            label="입력한 시각의 시간대"
            value={draft.sourceTimeZone}
            onChangeText={(sourceTimeZone) => edit({ sourceTimeZone })}
            autoCapitalize="none"
            maxLength={80}
            editable={!locked}
            hint="여행 중이면 결제 현지 시간대를 입력해 주세요. 장부의 거주 기준은 바뀌지 않아요."
          />
          {clock?.status === "ambiguous" ? (
            <View style={{ gap: 8 }}>
              <Text style={common.body}>어느 시점의 거래인가요?</Text>
              {clock.options.map((option) => (
                <Action
                  key={option.choice}
                  secondary={draft.timeChoice !== option.choice}
                  disabled={locked}
                  label={`${option.choice === "earlier" ? "첫 번째" : "두 번째"} ${draft.clock} (UTC${option.offset})`}
                  action={() => edit({ timeChoice: option.choice })}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      <ChoiceField
        label="계좌 (선택)"
        value={draft.accountId}
        disabled={locked}
        options={[
          { id: null, name: "미지정" },
          ...context.accounts
            .filter((item) => item.archivedAt === null)
            .map((item) => ({ id: item.id, name: item.name })),
        ]}
        onChange={(accountId) => edit({ accountId })}
      />
      <ChoiceField
        label="카테고리 (선택)"
        value={draft.categoryId}
        disabled={locked}
        options={[
          { id: null, name: "미분류" },
          ...context.categories
            .filter(
              (item) => item.archivedAt === null && item.kind === draft.type,
            )
            .map((item) => ({ id: item.id, name: item.name })),
        ]}
        onChange={(categoryId) => edit({ categoryId })}
      />
      <Field
        label="거래 상대명 (선택)"
        value={draft.counterpartyName}
        onChangeText={(counterpartyName) => edit({ counterpartyName })}
        maxLength={100}
        editable={!locked}
        placeholder="예: 한일마트, 김경희"
        hint="카테고리와 별개로, 돈을 주고받은 대상의 이름이에요."
      />
      <Field
        label="메모 (선택)"
        value={draft.memo}
        onChangeText={(memo) => edit({ memo })}
        maxLength={500}
        multiline
        editable={!locked}
        style={{ minHeight: 96, textAlignVertical: "top" }}
      />
    </>
  );
}
