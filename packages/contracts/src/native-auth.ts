import { z } from "zod";
import { SignInInputSchema } from "./auth.js";

/** 설치 ID는 기기 구분값일 뿐 인증 증명이 아니다. 서버가 소유자를 결정한다. */
export const NativeDeviceIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
/** 정확히 32바이트인 canonical base64url. JWT나 제공자 토큰을 받지 않는다. */
export const NativeSessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
export const NativeSignInInputSchema = SignInInputSchema.extend({ deviceId: NativeDeviceIdSchema }).strict();
export const NativeSessionSchema = z.object({
  authenticated: z.literal(true), userId: z.uuid(), deviceId: NativeDeviceIdSchema,
  refreshAt: z.iso.datetime(),
}).strict();
export const NativeAuthResponseSchema = z.object({ sessionToken: NativeSessionTokenSchema, session: NativeSessionSchema }).strict();
export type NativeSignInInput = z.infer<typeof NativeSignInInputSchema>;
export type NativeSession = z.infer<typeof NativeSessionSchema>;
export type NativeAuthResponse = z.infer<typeof NativeAuthResponseSchema>;
