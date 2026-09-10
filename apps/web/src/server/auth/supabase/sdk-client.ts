import "server-only";

import { createClient } from "@supabase/supabase-js";

export const AUTH_OPTIONS = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "pkce" } as const;

export type SupabaseClient = Readonly<{ auth: {
  /**
   * SDK에 이메일·비밀번호 로그인 요청을 맡기는 최소 인터페이스입니다.
   * @param input SDK 로그인 입력.
   * @returns SDK 원시 응답; 어댑터에서 검증합니다.
   */
  signInWithPassword(input: unknown): Promise<unknown>;
  /**
   * SDK에 갱신 토큰 교환을 맡기는 최소 인터페이스입니다.
   * @param input refresh_token을 포함한 SDK 입력.
   * @returns SDK 원시 응답.
   */
  refreshSession(input: unknown): Promise<unknown>;
  /**
   * 서버 요청용 SDK 클라이언트에 접근·갱신 토큰을 연결합니다.
   * @param input access_token·refresh_token 입력.
   * @returns SDK가 확인한 세션 응답.
   */
  setSession(input: unknown): Promise<unknown>;
  /**
   * 현재 SDK 세션의 로그아웃을 요청하는 최소 인터페이스입니다.
   * @returns SDK 성공 또는 오류 응답.
   */
  signOut(): Promise<unknown>;
  /**
   * 현재 SDK 사용자 정보를 변경합니다.
   * @param input 변경할 비밀번호 등 사용자 필드.
   * @returns SDK 성공 또는 오류 응답.
   */
  updateUser(input: unknown): Promise<unknown>;
} }>;

/** 각 비-PKCE 작업에 새 비영속 Supabase 클라이언트를 만드는 테스트 seam입니다. */
export type SupabaseClientFactory = (url: string, anonKey: string, auth: typeof AUTH_OPTIONS) => SupabaseClient;

/**
 * 브라우저 저장이나 자동 갱신을 하지 않는 새 서버용 SDK 클라이언트를 생성합니다.
 * @param url 검증된 Supabase 기본 URL.
 * @param anonKey 공개 anon 키.
 * @param auth 고정 비영속 PKCE 옵션.
 * @returns 현재 작업 전용 Supabase 클라이언트.
 */
export const defaultSupabaseClientFactory: SupabaseClientFactory = (url, anonKey, auth) =>
  createClient(url, anonKey, { auth }) as unknown as SupabaseClient;
