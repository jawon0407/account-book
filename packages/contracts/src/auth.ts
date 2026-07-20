import { z } from "zod";

const EmailSchema = z.email().max(254);
const PasswordSchema = z.string().min(12).max(1024);

export const AuthProviderSchema = z.enum(["google", "kakao", "naver"]);
export type AuthProvider = z.infer<typeof AuthProviderSchema>;

export const SignUpInputSchema = z.object({ email: EmailSchema, password: PasswordSchema }).strict();
export type SignUpInput = z.infer<typeof SignUpInputSchema>;

export const SignInInputSchema = z.object({ email: EmailSchema, password: PasswordSchema }).strict();
export type SignInInput = z.infer<typeof SignInInputSchema>;

export const PasswordResetRequestInputSchema = z.object({ email: EmailSchema }).strict();
export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestInputSchema>;

export const PasswordUpdateInputSchema = z.object({ password: PasswordSchema }).strict();
export type PasswordUpdateInput = z.infer<typeof PasswordUpdateInputSchema>;

export const CurrentUserSchema = z.object({
  id: z.uuid(),
  email: EmailSchema.nullable(),
  emailVerified: z.boolean(),
}).strict();
export type CurrentUser = z.infer<typeof CurrentUserSchema>;
