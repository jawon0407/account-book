import { TransactionListQuerySchema } from "@account-book/contracts";
import { CoreBoundaryError } from "./http-boundary.js";

/** @param search 신뢰하지 않는 브라우저 query. @returns 검증·정규화된 고정 거래 경로. 이 문자열 그대로 서명하고 전송한다. */
export function transactionTarget(search: URLSearchParams): `/${string}` {
  const entries = [...search.entries()], values: Record<string, unknown> = Object.fromEntries(entries);
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new CoreBoundaryError("LEDGER_VALIDATION_FAILED", 400);
  if (values.limit !== undefined) {
    if (typeof values.limit !== "string" || !/^[1-9]\d{0,2}$/u.test(values.limit)) throw new CoreBoundaryError("LEDGER_VALIDATION_FAILED", 400);
    values.limit = Number(values.limit);
  }
  const result = TransactionListQuerySchema.safeParse(values);
  if (!result.success) throw new CoreBoundaryError("LEDGER_VALIDATION_FAILED", 400);
  const normalized = new URLSearchParams(entries.map(([key]) => [key, String(result.data[key as keyof typeof result.data])]));
  return `/v1/transactions${entries.length ? `?${normalized}` : ""}`;
}
