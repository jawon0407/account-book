import { sql } from "drizzle-orm/sql";
import { bigint, check, foreignKey, index, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const appIdentity = pgSchema("user");
/** Supabase 관리 테이블의 FK 대상만 선언한다. 이 선언으로 auth.users를 생성/관리하지 않는다. */
export const authUsersReference = pgSchema("auth").table("users", { id: uuid("id").primaryKey() });

/** 앱 프로필. 가입 공급자와 탈퇴 시각은 일반 프로필 PATCH의 수정 대상이 아니다. */
export const profiles = appIdentity.table("users", {
  userId: uuid("user_id").primaryKey(), nickname: text("nickname"), avatarObjectKey: text("avatar_object_key"),
  signupProvider: text("signup_provider", { enum: ["email", "google", "kakao", "naver", "unknown"] }).notNull().default("unknown"),
  version: bigint("version", { mode: "bigint" }).notNull().default(1n),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
},
/** @param t 프로필 열. @returns 사용자 연결과 입력 경계. trigger/GRANT는 SQL migration에서 관리한다. */
t => [
  foreignKey({ name: "profiles_user_id_fkey", columns: [t.userId], foreignColumns: [authUsersReference.id] }).onDelete("cascade"),
  check("profiles_nickname", sql`${t.nickname} is null or (${t.nickname}=btrim(${t.nickname}) and char_length(${t.nickname}) between 1 and 50)`),
  check("profiles_avatar", sql`${t.avatarObjectKey} is null or (char_length(${t.avatarObjectKey}) between 38 and 512 and left(${t.avatarObjectKey},37)=${t.userId}::text||'/' and ${t.avatarObjectKey} !~ '[[:cntrl:]]' and position('..' in ${t.avatarObjectKey})=0 and position(chr(92) in ${t.avatarObjectKey})=0 and position('://' in ${t.avatarObjectKey})=0)`),
  check("profiles_provider", sql`${t.signupProvider} in ('email','google','kakao','naver','unknown')`),
  check("profiles_version", sql`${t.version} between 1 and 9007199254740991`),
  check("profiles_times", sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt}) and ${t.updatedAt}>=${t.createdAt} and (${t.deletedAt} is null or (isfinite(${t.deletedAt}) and ${t.deletedAt}>=${t.createdAt}))`),
]).enableRLS();

/** 서비스 권한은 프로필과 분리한다. 일반 API 런타임은 읽기만 가능하다. */
export const userRoles = appIdentity.table("roles", {
  userId: uuid("user_id").primaryKey(), role: text("role", { enum: ["member", "admin"] }).notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
/** @param t 역할 열. @returns 계정 FK와 허용 역할·유한 시각 제약. */
t => [
  foreignKey({ name: "user_roles_user_id_fkey", columns: [t.userId], foreignColumns: [authUsersReference.id] }).onDelete("cascade"),
  check("user_roles_role", sql`${t.role} in ('member','admin')`),
  check("user_roles_times", sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt}) and ${t.updatedAt}>=${t.createdAt}`),
]).enableRLS();

/** 권한 변경 감사. 사용자 삭제로 자동 소실되지 않으며 운영 보존/정리 정책은 별도다. */
export const roleChangeEvents = appIdentity.table("role_history", {
  id: uuid("id").primaryKey().defaultRandom(), targetUserId: uuid("target_user_id").notNull(),
  previousRole: text("previous_role", { enum: ["member", "admin"] }), newRole: text("new_role", { enum: ["member", "admin"] }),
  dbActor: text("db_actor").notNull(), reason: text("reason", { enum: ["bootstrap", "migration", "role_change", "role_revoke"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
/** @param t 감사 열. @returns 실제 변화만 허용하는 제약과 사용자/보존 시각 조회 인덱스. */
t => [
  check("role_events_roles", sql`(${t.previousRole} is null or ${t.previousRole} in ('member','admin')) and (${t.newRole} is null or ${t.newRole} in ('member','admin')) and ${t.previousRole} is distinct from ${t.newRole}`),
  check("role_events_reason", sql`${t.reason} in ('bootstrap','migration','role_change','role_revoke')`),
  check("role_events_time", sql`isfinite(${t.createdAt})`),
  index("role_events_target_time").on(t.targetUserId, t.createdAt), index("role_events_time").on(t.createdAt),
]).enableRLS();
