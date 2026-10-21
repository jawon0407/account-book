import type { Transaction } from "@account-book/contracts";

/** @param row 서버 거래. 검증된 safe integer를 BigInt로 표시해 소수점 변환을 하지 않는다. */
export function transactionLabel(row: Transaction) {
  const income =
    row.kind === "income" ||
    row.kind === "transfer_in" ||
    (row.kind === "opening_balance" && row.direction === "asset");
  const kind =
    row.kind === "income"
      ? "수입"
      : row.kind === "expense"
        ? "지출"
        : row.kind === "opening_balance"
          ? "시작 잔액"
          : "계좌 이체";
  return {
    title: row.counterpartyName ?? "거래 상대 미확인",
    amount: `${income ? "+" : "−"}${BigInt(row.amountKrw).toLocaleString("ko-KR")}원`,
    detail: `${row.occurredOn} · ${kind}`,
    unassigned: [
      row.accountId === null ? "계좌 미지정" : null,
      (row.kind === "income" || row.kind === "expense") &&
      row.categoryId === null
        ? "미분류"
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
/** @param previous 표시 중인 페이지. @param next 다음 페이지. 중첩 ID는 최초 행을 유지한다. */
export function mergePage(
  previous: Transaction[],
  next: Transaction[],
): Transaction[] {
  const seen = new Set(previous.map((row) => row.id));
  return [
    ...previous,
    ...next.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    }),
  ];
}
