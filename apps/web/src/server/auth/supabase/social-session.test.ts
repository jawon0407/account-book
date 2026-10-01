import { expect, it, vi } from "vitest";
import { adapter, client, issuedAtSeconds, jsonResponse, jwt, ok, rawSession, session, userId, verifier } from "./test-fixtures.js";

vi.mock("server-only", () => ({}));

/** Supabase 서버가 반환하는 이메일 없는 OAuth 세션의 합성 fixture. 실제 계정·서명은 사용하지 않는다. */
function social(provider = "kakao") {
  return {
    ...rawSession,
    access_token: jwt({ amr: [{ method: "oauth", timestamp: issuedAtSeconds }], is_anonymous: false }),
    user: { id: userId, email: "", email_confirmed_at: null, is_anonymous: false,
      identities: [{ id: "provider-subject", user_id: userId, provider, identity_data: { sub: "provider-subject" } }] },
  };
}

it.each(["kakao", "naver"] as const)("accepts an email-less %s OAuth identity without claiming email verification", async (provider) => {
  const response = social(provider === "naver" ? "custom:naver" : provider);
  const result = await adapter([jsonResponse(response)]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier, provider });
  expect(result.user).toEqual({ id: userId, email: null, emailVerified: false });
});

it("refreshes an email-less OAuth session without inventing an email", async () => {
  const result = await adapter([], client({ refreshSession: vi.fn(async () => ok({ session: social() })) })).adapter.refresh("refresh-token");
  expect(result.user).toEqual({ id: userId, email: null, emailVerified: false });
});

it.each([
  ["unverified present email", { user: { ...social().user, email: "person@example.test" } }],
  ["anonymous", { user: { ...social().user, is_anonymous: true } }],
  ["anonymous JWT", { access_token: jwt({ amr: [{ method: "oauth", timestamp: issuedAtSeconds }], is_anonymous: true }) }],
  ["future OAuth proof", { access_token: jwt({ amr: [{ method: "oauth", timestamp: issuedAtSeconds + 1 }], is_anonymous: false }) }],
  ["password-only method", { access_token: jwt({ amr: [{ method: "password", timestamp: issuedAtSeconds }], is_anonymous: false }) }],
  ["unknown identity", { user: social("untrusted").user }],
  ["wrong provider", { user: social("custom:naver").user }],
  ["another user identity", { user: { ...social().user, identities: [{ ...social().user.identities[0], user_id: "123e4567-e89b-12d3-a456-426614174099" }] } }],
  ["editable metadata only", { user: { ...social().user, identities: [], user_metadata: { provider: "kakao", email_verified: true } } }],
  ["no OAuth proof", { access_token: session.access_token }],
] as const)("rejects email-less trust bypass: %s", async (_name, override) => {
  await expect(adapter([jsonResponse({ ...social(), ...override })]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier, provider: "kakao" })).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
});

it.each(["", "   ", undefined, 123])("rejects missing or invalid provider subject: %s", async (sub) => {
  const response = social();
  const user = { ...response.user, identities: [{ ...response.user.identities[0], identity_data: { sub } }] };
  await expect(adapter([jsonResponse({ ...response, user })]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier, provider: "kakao" })).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
});

it("requires the stored provider to allow an email-less code exchange", async () => {
  await expect(adapter([jsonResponse(social())]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier })).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
});

it("does not widen password, email-confirmation or recovery to email-less identities", async () => {
  const response = social();
  const subject = adapter([jsonResponse(response), jsonResponse(response)], client({ signInWithPassword: vi.fn(async () => ok({ session: response })) }));
  await expect(subject.adapter.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) })).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
  await expect(subject.adapter.confirmEmail({ code: "code", codeVerifier: verifier })).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
  await expect(subject.adapter.exchangeRecoveryCode({ code: "code", codeVerifier: verifier })).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
});
