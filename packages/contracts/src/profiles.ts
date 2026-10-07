import { z } from "zod";
import { ExpectedVersionSchema, LedgerIdSchema, TimestampSchema, VersionSchema } from "./ledger-common.js";

/** 닉네임만 수정한다. 권한·가입 경로·탈퇴·이미지는 별도 서버 작업이므로 strict로 거부한다. */
export const UpdateProfileInputSchema = z.object({
  nickname: z.string().trim().min(1).max(50).nullable(),
  expectedVersion: ExpectedVersionSchema,
}).strict();
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

/** 본인 앱 프로필의 공개 응답. Auth 비밀번호·이메일·토큰과 내부 감사 정보는 포함하지 않는다. */
export const ProfileSchema = z.object({
  id: LedgerIdSchema,
  nickname: z.string().min(1).max(50).nullable(),
  avatarObjectKey: z.string().min(38).max(512).nullable(),
  signupProvider: z.enum(["email", "google", "kakao", "naver", "unknown"]),
  role: z.enum(["member", "admin"]),
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export type Profile = z.infer<typeof ProfileSchema>;
