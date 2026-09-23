import { z } from "zod";
import { apiClient, type BrowserApiClient } from "./api-client.js";

const CsrfResponseSchema = z.object({ csrfToken: z.string().min(1).max(1024) }).strict();
const MUTATION_PATHS = new Set([
  "auth/sign-up",
  "auth/sign-in",
  "auth/oauth/google/start",
  "auth/oauth/kakao/start",
  "auth/oauth/naver/start",
  "auth/session/refresh",
  "auth/sign-out",
  "auth/password/reset-request",
  "auth/password/update",
]);

/**
 * 실제 ky와 테스트 HTTP 대역을 같은 좁은 타입으로 취급한다.
 * @param value - 공통 ky 인스턴스 또는 GET/POST를 구현한 대역이다.
 * @returns 동일 객체의 타입 단언 결과. 런타임 검증·복사·요청은 하지 않는다.
 */
function client(value: BrowserApiClient | typeof apiClient): BrowserApiClient {
  return value as unknown as BrowserApiClient;
}

/**
 * 현재 변경 요청에 사용할 CSRF 증표를 BFF에서 가져오고 응답 구조를 검증한다.
 * interaction이면 비밀번호 복구 절차에 묶인 증표를 요청한다. 증표를 영구 저장하지 않는다.
 * @param http - 같은 출처 HTTP 구현. 기본값은 공통 apiClient다.
 * @param context - default는 일반 인증, interaction은 비밀번호 갱신용 문맥이다.
 * @returns 1~1024자 csrfToken 문자열 Promise.
 * @throws AUTH_RESPONSE_INVALID 응답 계약 불일치. HTTP/JSON 오류도 호출자에게 전달된다.
 */
export async function getCsrfToken(http: BrowserApiClient | typeof apiClient = apiClient, context: "default" | "interaction" = "default"): Promise<string> {
  const path = context === "interaction" ? "auth/csrf?context=interaction" : "auth/csrf";
  const parsed = CsrfResponseSchema.safeParse(await client(http).get(path).json<unknown>());
  if (!parsed.success) throw new Error("AUTH_RESPONSE_INVALID");
  return parsed.data.csrfToken;
}

/**
 * 허용 목록에 있는 인증 변경 요청을 새 CSRF 증표와 함께 한 번 전송한다.
 * 경로를 먼저 검사하고 GET으로 증표를 얻은 뒤 X-CSRF-Token 헤더를 붙여 POST한다.
 * @param path - 예: auth/sign-in. 절대 URL이나 목록 밖 경로는 거부한다.
 * @param json - ky가 JSON으로 직렬화할 입력값. 구체적 계약 검증은 호출자의 책임이다.
 * @param http - 같은 출처 HTTP 구현. 기본 apiClient는 자동 재시도가 꺼져 있다.
 * @returns 아직 endpoint 응답 검증을 거치지 않은 JSON 값의 Promise.
 * @throws AUTH_CLIENT_PATH_INVALID 허용되지 않은 경로. CSRF 조회·POST 실패도 전파한다.
 */
export async function postWithCsrf(path: string, json: unknown, http: BrowserApiClient | typeof apiClient = apiClient): Promise<unknown> {
  if (!MUTATION_PATHS.has(path)) throw new Error("AUTH_CLIENT_PATH_INVALID");
  const csrfToken = await getCsrfToken(http, path === "auth/password/update" ? "interaction" : "default");
  return client(http).post(path, { json, headers: { "X-CSRF-Token": csrfToken } }).json<unknown>();
}
