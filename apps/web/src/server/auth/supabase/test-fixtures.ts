import { randomBytes } from "node:crypto";
import { expect, vi } from "vitest";
import type { EmailConfirmationTransactionRecord } from "../../persistence/auth-repository.js";
import { AuthProviderError } from "../auth-provider-port.js";
import { EmailAuthService } from "../email-auth-service.js";
import { SupabaseAuthAdapter } from "../supabase-auth-adapter.js";

export const issuedAtSeconds = Math.floor(Date.now() / 1000);
export const nowSeconds = issuedAtSeconds + 3600;
export const userId = "123e4567-e89b-12d3-a456-426614174001";
export const sessionId = "123e4567-e89b-12d3-a456-426614174002";
export const verifier = "v".repeat(43);
export const challenge = "A".repeat(43);

/**
 * 기본 사용자·세션·발급·만료 클레임에 덮어쓰기를 적용한 JWT 모양의 테스트 문자열을 만듭니다. 실제 암호학적 서명은 아닙니다.
 * @param claims 덮어쓸 JWT 클레임.
 * @returns 파서 시험용 세 구간 문자열.
 */
export function jwt(claims: Record<string, unknown> = {}) {
  return `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ session_id: sessionId, sub: userId, iat: issuedAtSeconds, exp: nowSeconds, ...claims })).toString("base64url")}.${Buffer.from("signature").toString("base64url")}`;
}

/**
 * 임의 JSON 페이로드로 JWT 모양 문자열을 만들어 객체 아닌 페이로드 등 오류 사례를 시험합니다.
 * @param payload 직렬화할 임의 JSON 값.
 * @returns 실제 서명이 없는 테스트 JWT 문자열.
 */
export function jwtPayload(payload: unknown) {
  return `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${Buffer.from("signature").toString("base64url")}`;
}

export const accessToken = jwt();
export const session = {
  access_token: accessToken,
  refresh_token: "refresh-token",
  expires_at: nowSeconds,
  user: { id: userId, email: "person@example.test", email_confirmed_at: "2026-07-20T00:00:00.000Z" },
};
export const rawSession = { ...session, token_type: "bearer", expires_in: 3600 };

/**
 * SDK 성공 응답 형태인 data와 error: null을 간단히 만듭니다.
 * @param data SDK 응답 데이터.
 * @returns 성공 응답 대역 객체.
 */
export const ok = (data: unknown) => ({ data, error: null });

/**
 * 성공 응답을 기본값으로 갖는 SDK 메서드 대역들을 만들고 필요한 메서드만 교체합니다.
 * @param overrides 실패·잘못된 세션 등을 재현할 메서드 덮어쓰기.
 * @returns auth 메서드 대역을 가진 SDK 객체.
 */
export function client(overrides: Partial<Record<string, unknown>> = {}) {
  const auth = {
    signUp: vi.fn(),
    /**
     * 실제 로그인 없이 SDK 정상 세션 응답을 반환하고 호출을 기록합니다.
     * @returns 정상 세션을 data에 담은 SDK 응답.
     */
    signInWithPassword: vi.fn(async () => ok({ session })),
    exchangeCodeForSession: vi.fn(),
    signInWithOAuth: vi.fn(),
    /**
     * 실제 갱신 없이 정상 세션 응답을 반환하는 SDK 대역입니다.
     * @returns 정상 세션을 data에 담은 SDK 응답.
     */
    refreshSession: vi.fn(async () => ok({ session })),
    /**
     * 실제 자격 증명 검사 없이 세션 설정 성공 응답을 재현합니다.
     * @returns 정상 세션 SDK 응답.
     */
    setSession: vi.fn(async () => ok({ session })),
    /**
     * 외부 로그아웃 없이 SDK 성공 형태를 반환합니다.
     * @returns data와 error가 null인 응답.
     */
    signOut: vi.fn(async () => ({ data: null, error: null })),
    resetPasswordForEmail: vi.fn(),
    /**
     * 실제 사용자 변경 없이 준비된 사용자 정보를 돌려줍니다.
     * @returns 테스트 사용자가 담긴 SDK 성공 응답.
     */
    updateUser: vi.fn(async () => ok({ user: session.user })),
    ...overrides,
  };
  return { auth };
}

/**
 * 본문을 JSON으로 직렬화해 HTTP 응답 대역을 만듭니다.
 * @param body 직렬화할 응답 데이터.
 * @param status HTTP 상태; 기본 200.
 * @returns JSON 콘텐츠 타입의 Response.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * 준비된 HTTP 응답 큐와 SDK 대역을 실제 어댑터에 연결해 네트워크 없이 경계를 시험합니다.
 * @param responses fetch가 차례로 꺼낼 Response 목록; 호출 시 배열이 소비됩니다.
 * @param sdk 사용할 SDK 대역.
 * @returns 어댑터·SDK·생성 및 전송 기록 함수.
 */
export function adapter(responses: Response[] = [], sdk = client()) {
  /**
   * SDK 생성 호출을 기록하고 준비한 동일 SDK 대역을 반환합니다.
   * @returns 테스트에서 지정한 SDK 객체.
   */
  const factory = vi.fn(() => sdk);
  /**
   * HTTP 호출을 기록하며 응답 큐를 앞에서 하나씩 소비합니다. 큐가 비면 빈 JSON 성공 응답을 만듭니다.
   * @returns 다음 준비 응답 또는 빈 JSON Response.
   */
  const fetcher = vi.fn<typeof fetch>(async () => responses.shift() ?? jsonResponse({}));
  return {
    sdk,
    factory,
    fetcher,
    adapter: new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, factory, fetcher),
  };
}

/**
 * 기록된 fetch 호출이 존재하는지 확인하고 URL과 RequestInit을 꺼냅니다.
 * @param setup 어댑터 테스트 환경.
 * @param index 확인할 호출의 0기준 순번.
 * @returns 문자열 URL과 요청 설정.
 * @throws 해당 호출이 없으면 테스트 실패.
 */
export function request(setup: ReturnType<typeof adapter>, index: number) {
  const call = setup.fetcher.mock.calls[index];
  expect(call).toBeDefined();
  return { url: String(call?.[0]), init: call?.[1] as RequestInit };
}

/**
 * 제공자 오류의 타입·코드와 민감값 비노출을 한 번에 확인합니다.
 * @param action 실패해야 하는 비동기 작업.
 * @param code 기대하는 고정 제공자 오류 코드.
 * @param secrets 메시지에 없어야 하는 문자열 목록.
 * @returns 오류 assertion 완료 Promise.
 */
export function expectSafeError(action: () => Promise<unknown>, code: string, ...secrets: string[]) {
  return expect(action()).rejects.toSatisfy((error: unknown) =>
    error instanceof AuthProviderError && error.code === code && secrets.every((secret) => !error.message.includes(secret)),
  );
}

/**
 * 실제 이메일 서비스에 지정한 제공자와 간단한 메모리 저장소·세션 대역을 연결해 통합 흐름을 준비합니다.
 * @param provider 시험에 사용할 Supabase 어댑터.
 * @returns 이메일 서비스·세션 대역·콜백 컨텍스트.
 */
export function emailFlow(provider: ReturnType<typeof adapter>["adapter"]) {
  let record: EmailConfirmationTransactionRecord | null = null;
  const repository = {
    /**
     * 이메일 서비스가 저장하는 레코드를 한 변수에 보관하는 대역입니다.
     * @param input 저장할 이메일 확인 트랜잭션.
     * @returns 보관 후 값 없음.
     */
    createEmailConfirmationTransaction: vi.fn(async (input: EmailConfirmationTransactionRecord) => { record = input; }),
    /**
     * 보관된 레코드가 있으면 소비 시각을 붙여 반환합니다. 이 간소화 대역은 해시·만료·재사용을 검증하지 않습니다.
     * @param _hash 사용하지 않는 브라우저 해시 인자.
     * @param claimedAt 붙일 소비 시각.
     * @returns 레코드 또는 없으면 null.
     */
    claimEmailConfirmationTransaction: vi.fn(async (_hash: Uint8Array, claimedAt: Date) => {
      if (record === null) return null;
      record = { ...record, consumedAt: new Date(claimedAt) };
      return record;
    }),
  };
  const sessions = {
    /**
     * 실제 세션 저장 없이 이메일 흐름 완료에 필요한 공개 세션 메타데이터를 만듭니다.
     * @returns 가짜 식별자·1분 접근 만료·하루 절대 만료 정보.
     */
    create: vi.fn(async () => ({ selector: "selector", accessTokenExpiresAt: new Date(Date.now() + 60_000), absoluteExpiresAt: new Date(Date.now() + 86_400_000) })),
  };
  const keyring = { currentKeyId: "current", keys: new Map([["current", randomBytes(32)]]) };
  const service = new EmailAuthService(provider, sessions, repository, keyring, () => "123e4567-e89b-12d3-a456-426614174090", () => verifier, () => new Date());
  const context = { emailRedirectUrl: new URL("https://app.example.test/auth/confirm"), interactionSelector: Buffer.alloc(32, 10).toString("base64url"), now: new Date() };
  return { service, sessions, context };
}
