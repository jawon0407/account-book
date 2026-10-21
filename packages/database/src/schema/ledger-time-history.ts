import { sql } from "drizzle-orm/sql";
import { bigint, check, foreignKey, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appIdentity, authUsersReference } from "./identity.js";

/** 거주 장부 시간대의 추가형 이력. revision/시각은 trigger가 채우며 API는 UPDATE/DELETE 불가다. */
export const ledgerTimeHistory = appIdentity.table("ledger_time_history", {
  userId: uuid("user_id").notNull(), revision: bigint("revision", { mode: "bigint" }).notNull(),
  timeZone: text("time_zone").notNull(), effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
},
/** @param t 이력 열. @returns 소유자 FK/순번/최초 기준/DB 시각 제약. 잠금과 열 권한은 SQL에서 관리한다. */
t => [
  primaryKey({ columns: [t.userId,t.revision] }),
  foreignKey({ name: "ledger_time_history_user_id_fkey", columns: [t.userId], foreignColumns: [authUsersReference.id] }).onDelete("cascade"),
  check("ledger_time_history_revision", sql`${t.revision} between 1 and 9007199254740991`),
  check("ledger_time_history_zone", sql`"user".is_ledger_time_zone(${t.timeZone})`),
  check("ledger_time_history_baseline", sql`(${t.revision}=1)=(${t.effectiveFrom} is null)`),
  check("ledger_time_history_clock", sql`isfinite(${t.createdAt}) and ${t.createdAt} between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999+00' and ${t.createdAt}=date_trunc('milliseconds',${t.createdAt},'UTC') and (${t.effectiveFrom} is null or ${t.effectiveFrom}=${t.createdAt})`),
  uniqueIndex("ledger_time_history_effective").on(t.userId,t.effectiveFrom).where(sql`${t.effectiveFrom} is not null`),
]).enableRLS();
