import { sql } from "drizzle-orm/sql";
import { check, integer, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./identity.js";

/** 회원·설치별 최신 알림 동의. 직접 접근은 SQL ACL로 금지하고 제한 함수에서만 변경한다. */
export const notificationConsent = pgSchema("app_private").table("notification_consent", {
  userId: uuid("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull(),
  version: integer("version").notNull().default(0),
  noticeVersion: text("notice_version"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
},
/** @param t 동의 열. @returns 소유자/설치 PK와 시각·버전 제약. FORCE RLS는 migration에서 관리한다. */
t => [
  primaryKey({ columns: [t.userId,t.deviceId] }),
  check("notification_consent_version_check",sql`${t.version}>=0`),
  check("notification_consent_notice_version_check",sql`${t.noticeVersion} is null or length(${t.noticeVersion}) between 1 and 80`),
  check("notification_consent_accepted_at_check",sql`${t.acceptedAt} is null or isfinite(${t.acceptedAt})`),
  check("notification_consent_withdrawn_at_check",sql`${t.withdrawnAt} is null or isfinite(${t.withdrawnAt})`),
  check("notification_consent_updated_at_check",sql`isfinite(${t.updatedAt})`),
  check("notification_consent_check",sql`(${t.noticeVersion} is null)=(${t.acceptedAt} is null)`),
  check("notification_consent_check1",sql`${t.withdrawnAt} is null or ${t.acceptedAt} is null or ${t.withdrawnAt}>=${t.acceptedAt}`),
]).enableRLS();
