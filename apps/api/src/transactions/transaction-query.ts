import { TransactionListQuerySchema, type TransactionListQuery } from "@account-book/contracts";
import { CoreError } from "../core/core-error.js";
import { input } from "../core/validation.js";

/** @param raw HTTP query 객체. @returns limit만 정수로 바꾼 strict 계약; 배열/중복/unknown은 거부한다. */
export function parseTransactionQuery(raw: unknown): TransactionListQuery {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CoreError("LEDGER_VALIDATION_FAILED", 400);
  const values = { ...raw } as Record<string, unknown>;
  if (values.limit !== undefined) {
    if (typeof values.limit !== "string" || !/^[1-9]\d{0,2}$/u.test(values.limit)) throw new CoreError("LEDGER_VALIDATION_FAILED", 400);
    values.limit = Number(values.limit);
  }
  return input(TransactionListQuerySchema, values);
}
