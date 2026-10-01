import { createHash } from "node:crypto";
import { CursorSchema, LedgerIdSchema, LocalDateSchema, type TransactionListQuery } from "@account-book/contracts";
import { z } from "zod";
import { CoreError } from "../core/core-error.js";

const Payload = z.object({ v: z.literal(1), date: LocalDateSchema, id: LedgerIdSchema, binding: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
/** @param userId 인증 소유자. @param query 정규화 필터. @returns 페이지 크기와 무관한 데이터 집합 결속값; 인증 서명은 아니다. */
function binding(userId: string, query: TransactionListQuery): string {
  return createHash("sha256").update(JSON.stringify([userId, query.accountId ?? null, query.categoryId ?? null, query.from ?? null, query.to ?? null, query.type ?? null])).digest("hex");
}
/** @param userId 인증 소유자. @param query 필터. @param last 마지막 공개 행의 정렬키. @returns 금융 내용/소유자 원문이 없는 다음 페이지 커서. */
export function encodeCursor(userId: string, query: TransactionListQuery, last: { occurredOn: string; id: string }): string {
  return Buffer.from(JSON.stringify({ v: 1, date: last.occurredOn, id: last.id, binding: binding(userId, query) })).toString("base64url");
}
/** @param userId 인증 소유자. @param query 필터와 opaque cursor. @returns SQL keyset 경계; 위조해도 SQL 소유권/RLS는 별도로 적용한다. */
export function decodeCursor(userId: string, query: TransactionListQuery): { date: string; id: string } | null {
  if (query.cursor === undefined) return null;
  try {
    const token = CursorSchema.parse(query.cursor), value = Payload.parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
    const canonical = encodeCursor(userId, query, { occurredOn: value.date, id: value.id });
    if (value.binding !== binding(userId, query) || canonical !== token) throw new Error("invalid");
    return { date: value.date, id: value.id };
  } catch { throw new CoreError("LEDGER_VALIDATION_FAILED", 400); }
}
