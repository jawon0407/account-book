import "server-only";

import { fail } from "./error-mapper.js";
import { object, type SupabaseServerConfig } from "./validation.js";

/** 서버 전용 Supabase Auth HTTP 경계의 fetch 테스트 seam입니다. */
export type SupabaseFetch = typeof fetch;
export type HttpResult = Readonly<{ ok: boolean; status: number; body: unknown }>;

/**
 * anon 키 헤더와 JSON 본문으로 POST를 보내 응답을 파싱합니다. 실패 응답의 파싱 오류는 null 본문으로 숨깁니다.
 * @param config 검증된 Supabase 공개 설정.
 * @param fetcher 서버 PKCE 요청용 fetch 함수.
 * @param url 요청할 제공자 URL.
 * @param body JSON으로 직렬화할 요청 객체.
 * @returns ok·status·body가 있는 HTTP 결과.
 * @throws 성공 응답이 잘못된 JSON/객체이거나 네트워크가 실패하면 오류.
 */
export async function requestSupabaseAuth(config: SupabaseServerConfig, fetcher: SupabaseFetch, url: URL, body: Record<string, unknown>): Promise<HttpResult> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${config.anonKey}`, "Content-Type": "application/json", apikey: config.anonKey },
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  try { parsed = await response.json(); } catch {
    if (response.ok) return fail();
    return { ok: false, status: response.status, body: null };
  }
  return { ok: response.ok, status: response.status, body: response.ok ? object(parsed) : parsed };
}

/**
 * 가입 또는 복구 API URL에 신뢰된 redirect_to를 넣고 공통 POST 함수로 전송합니다.
 * @param config 검증된 Supabase 공개 설정.
 * @param fetcher 서버 PKCE 요청용 fetch 함수.
 * @param path signup 또는 recover 경로.
 * @param body 제공자에게 보낼 JSON 객체.
 * @param redirect 신뢰된 콜백 URL.
 * @returns 성공 여부·상태 코드·파싱된 응답.
 * @throws 네트워크·응답 파싱 오류.
 */
export async function postSupabaseAuth(config: SupabaseServerConfig, fetcher: SupabaseFetch, path: "signup" | "recover", body: Record<string, unknown>, redirect: URL): Promise<HttpResult> {
  const url = new URL(`auth/v1/${path}`, config.url);
  url.searchParams.set("redirect_to", redirect.toString());
  return requestSupabaseAuth(config, fetcher, url, body);
}
