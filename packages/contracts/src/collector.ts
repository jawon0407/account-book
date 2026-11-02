import { z } from "zod";

/** DB integer와 같은 범위. 최초 미설정 상태의 버전 0도 허용한다. */
const CollectorVersionSchema = z.number().int().min(0).max(2147483647);
/** 기기 교체는 묵시적으로 승인하지 않는다. 소유자·세션 ID는 서버 인증 문맥에서만 얻는다. */
export const CollectorChangeInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("activate"), expectedVersion: CollectorVersionSchema, replaceExisting: z.boolean() }).strict(),
  z.object({ action: z.literal("deactivate"), expectedVersion: CollectorVersionSchema }).strict(),
]);
/** 다른 기기의 식별자는 공개하지 않고 현재 요청 세션 기준의 상태만 반환한다. */
export const CollectorStateSchema = z.object({
  version: CollectorVersionSchema,
  state: z.enum(["inactive", "active_here", "active_elsewhere"]),
}).strict().refine(value => value.state === "inactive" || value.version > 0);
export type CollectorChangeInput = z.infer<typeof CollectorChangeInputSchema>;
export type CollectorState = z.infer<typeof CollectorStateSchema>;
