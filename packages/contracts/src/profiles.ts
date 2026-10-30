import { z } from "zod";
import { utf16Length } from "./string-length.js";
import { ExpectedVersionSchema, LedgerIdSchema, TimestampSchema, VersionSchema } from "./ledger-common.js";
import { LedgerTimeZoneSchema } from "./ledger-time.js";

/** 닉네임/거주 시간대만 수정한다. 권한·효력 시각·가입 경로·탈퇴·이미지는 strict로 거부한다. */
export const UpdateProfileInputSchema = z.object({
  nickname: z.string().trim().check(utf16Length(1, 50)).nullable().optional(),
  ledgerTimeZone: LedgerTimeZoneSchema.optional(),
  expectedVersion: ExpectedVersionSchema,
}).strict().refine(value => value.nickname !== undefined || value.ledgerTimeZone !== undefined, { message: "PROFILE_UPDATE_EMPTY" });
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

/** 본인 앱 프로필의 공개 응답. Auth 비밀번호·이메일·토큰과 내부 감사 정보는 포함하지 않는다. */
export const ProfileSchema = z.object({
  id: LedgerIdSchema,
  nickname: z.string().check(utf16Length(1, 50)).nullable(),
  avatarObjectKey: z.string().check(utf16Length(38, 512)).nullable(),
  signupProvider: z.enum(["email", "google", "kakao", "naver", "unknown"]),
  role: z.enum(["member", "admin"]),
  // 구버전 응답은 생략 가능. 새 API는 미설정 null 또는 현재 거주 시간대를 반환한다.
  ledgerTimeZone: LedgerTimeZoneSchema.nullable().optional(),
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export type Profile = z.infer<typeof ProfileSchema>;
