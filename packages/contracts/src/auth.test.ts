import { describe, expect, it } from "vitest";
import {
  AuthProviderSchema,
  CurrentUserSchema,
  PasswordResetRequestInputSchema,
  PasswordUpdateInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
} from "./index.js";

const validEmail = "person@example.com";
const validPassword = "a".repeat(12);
const maximumEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;

describe("authentication input contracts", () => {
  it("accepts supported providers and minimum valid inputs", () => {
    expect(AuthProviderSchema.parse("google")).toBe("google");
    expect(AuthProviderSchema.parse("kakao")).toBe("kakao");
    expect(AuthProviderSchema.parse("naver")).toBe("naver");
    expect(SignUpInputSchema.parse({ email: validEmail, password: validPassword })).toEqual({
      email: validEmail,
      password: validPassword,
    });
    expect(SignInInputSchema.parse({ email: validEmail, password: validPassword })).toEqual({
      email: validEmail,
      password: validPassword,
    });
    expect(PasswordResetRequestInputSchema.parse({ email: validEmail })).toEqual({ email: validEmail });
    expect(PasswordUpdateInputSchema.parse({ password: validPassword })).toEqual({ password: validPassword });
  });

  it("accepts a valid 254-character email", () => {
    expect(maximumEmail).toHaveLength(254);
    expect(SignUpInputSchema.parse({ email: maximumEmail, password: validPassword })).toEqual({
      email: maximumEmail,
      password: validPassword,
    });
  });

  it("accepts a 1024-character password", () => {
    const maximumPassword = "a".repeat(1024);

    expect(PasswordUpdateInputSchema.parse({ password: maximumPassword })).toEqual({ password: maximumPassword });
  });

  it("rejects unsupported providers and invalid email boundaries", () => {
    expect(() => AuthProviderSchema.parse("github")).toThrow();
    expect(() => SignUpInputSchema.parse({ email: "invalid", password: validPassword })).toThrow();
    expect(() => SignUpInputSchema.parse({ email: `${"a".repeat(243)}@example.com`, password: validPassword })).toThrow();
  });

  it("rejects passwords outside the inclusive length range", () => {
    expect(() => SignInInputSchema.parse({ email: validEmail, password: "a".repeat(11) })).toThrow();
    expect(() => PasswordUpdateInputSchema.parse({ password: "a".repeat(1025) })).toThrow();
  });

  it("rejects unknown keys at each input boundary", () => {
    expect(() => SignUpInputSchema.parse({ email: validEmail, password: validPassword, role: "admin" })).toThrow();
    expect(() => SignInInputSchema.parse({ email: validEmail, password: validPassword, token: "secret" })).toThrow();
    expect(() => PasswordResetRequestInputSchema.parse({ email: validEmail, redirect: "https://evil.test" })).toThrow();
    expect(() => PasswordUpdateInputSchema.parse({ password: validPassword, currentPassword: validPassword })).toThrow();
  });
});

describe("current user contract", () => {
  it("accepts its minimum valid shape", () => {
    expect(CurrentUserSchema.parse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      email: null,
      emailVerified: false,
    })).toEqual({ id: "123e4567-e89b-12d3-a456-426614174000", email: null, emailVerified: false });
  });

  it("rejects invalid UUIDs, emails, and unknown keys", () => {
    expect(() => CurrentUserSchema.parse({ id: "not-a-uuid", email: validEmail, emailVerified: true })).toThrow();
    expect(() => CurrentUserSchema.parse({ id: "123e4567-e89b-12d3-a456-426614174000", email: "invalid", emailVerified: true })).toThrow();
    expect(() => CurrentUserSchema.parse({ id: "123e4567-e89b-12d3-a456-426614174000", email: validEmail, emailVerified: true, role: "admin" })).toThrow();
  });
});
