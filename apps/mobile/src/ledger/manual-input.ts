import {
  buildTimedLedgerTime,
  CreateTransactionInputSchema,
  LocalDateSchema,
  type Account,
  type Category,
  type CreateTransactionInput,
} from "@account-book/contracts";
import { ManualInputError } from "./manual-input-error";
import { resolveManualClock, type ClockChoice } from "./manual-time";

export type ManualDraft = Readonly<{
  type: "income" | "expense";
  amount: string;
  date: string;
  clock: string;
  sourceTimeZone: string;
  historicalLedgerTimeZone?: string;
  timeChoice: ClockChoice | null;
  accountId: string | null;
  categoryId: string | null;
  counterpartyName: string;
  memo: string;
}>;
export type ManualContext = Readonly<{
  accounts: readonly Account[];
  categories: readonly Category[];
  ledgerTimeZone: string | null;
}>;
export type ManualInput = Omit<CreateTransactionInput, "idempotencyKey">;
const InputSchema = CreateTransactionInputSchema.omit({ idempotencyKey: true });

/**
 * @param draft 화면의 원시 입력. @param context 현재 계정의 활성 참조/명시 거주 기준.
 * @returns 서버 계약의 수기 값. 키 생성·HTTP·DB 쓰기 없이 입력만 정규화한다.
 */
export function buildManualInput(
  draft: ManualDraft,
  context: ManualContext,
): ManualInput {
  const money = draft.amount.trim();
  if (!/^(?:[0-9]+|[1-9][0-9]{0,2}(?:,[0-9]{3})+)$/u.test(money))
    throw new ManualInputError("amount", "AMOUNT_INVALID");
  const amountKrw = Number(money.replaceAll(",", ""));
  if (!Number.isSafeInteger(amountKrw) || amountKrw <= 0)
    throw new ManualInputError("amount", "AMOUNT_INVALID");
  if (!LocalDateSchema.safeParse(draft.date).success)
    throw new ManualInputError("date", "DATE_INVALID");
  if (
    draft.accountId !== null &&
    !context.accounts.some(
      (account) =>
        account.id === draft.accountId && account.archivedAt === null,
    )
  )
    throw new ManualInputError("accountId", "ACCOUNT_UNAVAILABLE");
  if (
    draft.categoryId !== null &&
    !context.categories.some(
      (category) =>
        category.id === draft.categoryId &&
        category.archivedAt === null &&
        category.kind === draft.type,
    )
  )
    throw new ManualInputError("categoryId", "CATEGORY_UNAVAILABLE");
  let occurredOn = draft.date;
  let time: CreateTransactionInput["time"];
  if (draft.clock.trim() !== "") {
    if (context.ledgerTimeZone === null)
      throw new ManualInputError("sourceTimeZone", "RESIDENCE_REQUIRED");
    const resolved = resolveManualClock(
      draft.date,
      draft.clock.trim(),
      draft.sourceTimeZone,
      draft.timeChoice ?? undefined,
    );
    if (resolved.status === "ambiguous")
      throw new ManualInputError("clock", "TIME_CHOICE_REQUIRED");
    time = resolved.time;
    try {
      occurredOn = buildTimedLedgerTime(
        { ...time, source: "user" },
        draft.historicalLedgerTimeZone?.trim() || context.ledgerTimeZone,
      ).occurredOn;
    } catch {
      throw new ManualInputError("sourceTimeZone", "TIME_ZONE_INVALID");
    }
  }
  const parsed = InputSchema.safeParse({
    type: draft.type,
    amountKrw,
    occurredOn,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    counterpartyName: draft.counterpartyName.trim() || null,
    ...(draft.memo.trim() === "" ? {} : { memo: draft.memo.trim() }),
    ...(time === undefined ? {} : { time }),
  });
  if (!parsed.success)
    throw new ManualInputError(
      parsed.error.issues[0]?.path[0]?.toString() ?? "form",
      "INPUT_INVALID",
    );
  return parsed.data;
}
