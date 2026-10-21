import type { z } from "zod";
import { CoreError } from "./core-error.js";
/** @param schema 공유 strict 계약. @param value 신뢰하지 않는 입력. @param profile 오류 구분. @returns HTTP 타입과 독립적인 정규화 값. */
export function input<T>(schema: z.ZodType<T>, value: unknown, profile = false): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CoreError(profile ? "PROFILE_VALIDATION_FAILED" : "LEDGER_VALIDATION_FAILED", 400);
  return result.data;
}
