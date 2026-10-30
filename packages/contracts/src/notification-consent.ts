import { z } from "zod";

/** 표시한 고지와 서버가 요구하는 고지는 일치해야 한다. 변경 시 SQL 검증 버전도 함께 이관한다. */
export const NOTIFICATION_NOTICE_VERSION = "notification-access-v1" as const;
const Generation = z.number().int().min(0).max(2147483647);
/** 신원/시각은 서버 세션·DB에서만 얻는다. 철회에는 새 고지 동의를 요구하지 않는다. */
export const NotificationConsentChangeInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), expectedVersion: Generation, noticeVersion: z.literal(NOTIFICATION_NOTICE_VERSION) }).strict(),
  z.object({ action: z.literal("withdraw"), expectedVersion: Generation }).strict(),
]);
/** 개인/기기 식별자 없는 공개 상태. 버전 0은 아직 서버 기록이 없는 경우뿐이다. */
export const NotificationConsentStateSchema = z.object({
  version: Generation,
  state: z.enum(["not_granted", "granted", "withdrawn", "outdated"]),
  noticeVersion: z.literal(NOTIFICATION_NOTICE_VERSION),
}).strict().refine(value => (value.state === "not_granted") === (value.version === 0));
export type NotificationConsentChangeInput = z.infer<typeof NotificationConsentChangeInputSchema>;
export type NotificationConsentState = z.infer<typeof NotificationConsentStateSchema>;
