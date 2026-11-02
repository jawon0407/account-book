import { sql } from "drizzle-orm/sql";
import { check, index, integer, pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";
import { authSessions } from "./auth.js";
import { profiles } from "./identity.js";

/** 계정당 하나의 자동 수집 권한. 세션 비밀/금융 알림은 복제하지 않으며 함수로만 접근한다. */
export const collectorState = pgSchema("app_private").table("collector_state", {
  userId: uuid("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  activeSessionId: uuid("active_session_id").references(() => authSessions.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
},
/** @param t 수집 권한 열. @returns 버전/시각 제약과 세션 삭제 시 참조 조회 인덱스. FORCE RLS/ACL은 SQL에서 관리한다. */
t => [
  check("collector_state_version_check", sql`${t.version}>=0`),
  check("collector_state_updated_at_check", sql`isfinite(${t.updatedAt})`),
  index("collector_state_session").on(t.activeSessionId).where(sql`${t.activeSessionId} is not null`),
]).enableRLS();
