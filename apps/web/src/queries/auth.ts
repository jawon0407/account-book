import {
  CurrentUserSchema,
  PasswordResetRequestInputSchema,
  PasswordUpdateInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
  type AuthProvider,
  type CurrentUser,
  type PasswordResetRequestInput,
  type PasswordUpdateInput,
  type SignInInput,
  type SignUpInput,
} from "@account-book/contracts";
import { mutationOptions, queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiClient, apiError, type BrowserApiClient } from "../lib/http/api-client.js";
import { postWithCsrf } from "../lib/http/csrf-client.js";

const AcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
const SignedOutSchema = z.object({ signedOut: z.literal(true) }).strict();
const UpdatedSchema = z.object({ updated: z.literal(true) }).strict();
const SignInResponseSchema = z.object({ user: CurrentUserSchema, expiresAt: z.iso.datetime(), absoluteExpiresAt: z.iso.datetime() }).strict();

/**
 * ky 또는 테스트 HTTP 대역을 query가 요구하는 최소 인터페이스로 취급한다.
 * @param value - 실제 공통 클라이언트 또는 주입한 대역이다.
 * @returns 같은 객체. 타입 단언만 하므로 런타임 변환·검증·요청은 없다.
 */
function client(value: BrowserApiClient | typeof apiClient): BrowserApiClient {
  return value as unknown as BrowserApiClient;
}

/**
 * CSRF 보호 POST의 응답을 endpoint별 계약으로 검사하는 공통 변경 요청 함수다.
 * @param path - 허용된 상대 인증 경로. 예: auth/sign-in.
 * @param input - 전송할 JSON 값. 입력 스키마 검증은 각 mutationFn에서 먼저 수행한다.
 * @param schema - 성공 응답을 검증하고 T로 좁힐 Zod 스키마다.
 * @param http - 같은 출처 HTTP 구현 또는 테스트 대역이다.
 * @returns 계약 검증을 통과한 T의 Promise.
 * @throws 실패는 apiError로 변환해 전달한다. 호출 시 CSRF 조회와 POST가 발생한다.
 */
async function parsedMutation<T>(path: string, input: unknown, schema: z.ZodType<T>, http: BrowserApiClient | typeof apiClient): Promise<T> {
  try {
    const parsed = schema.safeParse(await postWithCsrf(path, input, http));
    if (!parsed.success) throw new Error("AUTH_RESPONSE_INVALID");
    return parsed.data;
  } catch (error) {
    throw await apiError(error);
  }
}

/**
 * /api/me의 사용자 정보를 검사하고 갱신 필요 오류에 한해 세션을 한 번 갱신한다.
 * @param http - 사용자 조회와 CSRF 보호 갱신에 사용할 HTTP 구현이다.
 * @param refreshed - 이미 갱신을 시도했는지 표시한다. true이면 다시 갱신하지 않는다.
 * @returns 검증된 현재 사용자 Promise.
 * @throws 만료·CSRF 오류 또는 한 번 갱신 후 재실패는 공개 오류로 전파한다.
 */
async function currentUser(http: BrowserApiClient | typeof apiClient, refreshed: boolean): Promise<CurrentUser> {
  try {
    const parsed = CurrentUserSchema.safeParse(await client(http).get("me").json<unknown>());
    if (!parsed.success) throw new Error("AUTH_RESPONSE_INVALID");
    return parsed.data;
  } catch (error) {
    const safe = await apiError(error);
    if (!refreshed && safe.code === "AUTH_SESSION_REFRESH_REQUIRED") {
      await parsedMutation("auth/session/refresh", {}, z.object({ refreshed: z.literal(true) }).strict(), http);
      return currentUser(http, true);
    }
    throw safe;
  }
}

/**
 * 현재 사용자 조회를 갱신 미시도 상태로 시작한다.
 * @param http - 기본값은 apiClient. 테스트에서는 GET/POST 대역을 주입한다.
 * @returns CurrentUser Promise. 필요할 때만 한 번 갱신·재조회하며 그 외 오류는 전파한다.
 */
export function getCurrentUser(http: BrowserApiClient | typeof apiClient = apiClient): Promise<CurrentUser> {
  return currentUser(http, false);
}

/**
 * 현재 사용자 조회의 캐시 키와 실행 함수를 TanStack Query 설정으로 묶는다.
 * @param http - queryFn이 실행될 때 사용할 HTTP 구현. 기본값은 apiClient다.
 * @returns 키가 [auth, current-user]인 설정. 생성만으로 요청하지 않으며 라이브러리 재시도는 꺼진다.
 */
export function currentUserQueryOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return queryOptions({ queryKey: ["auth", "current-user"] as const, queryFn: () => getCurrentUser(http), retry: false });
}

/**
 * 컴포넌트에서 현재 사용자 조회 결과·로딩·오류 상태를 구독하는 React 훅이다.
 * @returns useQuery 결과. Provider의 메모리 캐시를 사용하며 마운트 시 조회가 발생할 수 있다.
 */
export function useCurrentUser() {
  return useQuery(currentUserQueryOptions());
}

/**
 * 이메일 로그인 입력 검증과 POST 실행 함수를 만든다.
 * mutationFn은 SignInInputSchema.parse 후 로그인 응답의 user/만료 시각을 검사한다.
 * @param http - CSRF 조회와 로그인 요청에 사용할 HTTP 구현이다.
 * @returns useMutation용 설정. 실행 시 입력 {email, password}를 받고 검증된 로그인 응답을 반환한다.
 * @remarks 입력 오류는 Zod 오류, 요청 오류는 공개 오류로 전달된다. 자동 재시도·영구 저장은 없지만 mutation 입력은 메모리 상태에 남을 수 있다.
 */
export function signInMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: (input: SignInInput) => parsedMutation("auth/sign-in", SignInInputSchema.parse(input), SignInResponseSchema, http), retry: false });
}

/**
 * 가입 입력을 검사하고 accepted 응답을 검증한다. 이미 가입한 이메일은 승인된 정책에 따라 409로 안내한다.
 * @param http - CSRF 보호 가입 요청에 사용할 HTTP 구현이다.
 * @returns {email, password}를 받아 {accepted: true}를 반환하는 mutation 설정. 실행 전에는 요청하지 않는다.
 * @remarks 입력/요청 오류를 전파하고 자동 재시도하지 않는다. accepted는 이메일 인증 완료를 뜻하지 않는다.
 */
export function signUpMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: (input: SignUpInput) => parsedMutation("auth/sign-up", SignUpInputSchema.parse(input), AcceptedSchema, http), retry: false });
}

/**
 * 현재 웹 세션의 로그아웃 POST를 실행할 설정을 만든다.
 * @param http - CSRF 조회와 로그아웃에 사용할 HTTP 구현이다.
 * @returns 입력 없이 빈 JSON을 보내 {signedOut: true}를 검증하는 mutation 설정.
 * @remarks 실행하면 서버 세션에 영향을 준다. 오류는 전파하며 이 함수는 query 캐시 제거를 수행하지 않는다.
 */
export function signOutMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: () => parsedMutation("auth/sign-out", {}, SignedOutSchema, http), retry: false });
}

/**
 * 재설정 이메일 요청 입력과 accepted 응답을 검사할 설정을 만든다.
 * @param http - CSRF 보호 재설정 요청에 사용할 HTTP 구현이다.
 * @returns {email}을 받아 {accepted: true}를 검증하는 mutation 설정.
 * @remarks 실행하면 메일 요청이 발생할 수 있다. 사용자 승인 정책에 따라 미가입 이메일은 404이며 입력/요청 오류를 전파한다.
 */
export function passwordResetMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: (input: PasswordResetRequestInput) => parsedMutation("auth/password/reset-request", PasswordResetRequestInputSchema.parse(input), AcceptedSchema, http), retry: false });
}

/**
 * 새 비밀번호를 검사하고 복구 문맥 CSRF를 사용해 변경하는 설정을 만든다.
 * @param http - CSRF 조회와 비밀번호 변경에 사용할 HTTP 구현이다.
 * @returns {password}를 받아 {updated: true}를 검증하는 mutation 설정.
 * @remarks 실행 시 비밀번호 변경 부작용이 발생한다. 입력/요청 오류를 전파하고 자동 재시도하지 않는다.
 */
export function passwordUpdateMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: (input: PasswordUpdateInput) => parsedMutation("auth/password/update", PasswordUpdateInputSchema.parse(input), UpdatedSchema, http), retry: false });
}

/**
 * 공급자 로그인 시작 요청과 같은 출처 계속 경로 검증을 연결한다.
 * @param http - CSRF 조회와 OAuth 시작 POST에 사용할 HTTP 구현이다.
 * @returns {provider, returnPath, intent?}를 받는 mutation 설정. 의도 생략은 로그인이며 명시한 의도는 계속 경로까지 정확히 일치해야 한다.
 * @remarks 실행하면 서버 OAuth 절차를 시작한다. 응답 경로 불일치는 공개 오류가 되고 화면 이동은 호출자가 담당한다.
 */
export function oauthStartMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({
    mutationFn: (input: Readonly<{ provider: AuthProvider; returnPath: "/app" | "/settings/security"; intent?: "sign_in" | "sign_up" }>) => {
      // callback은 요청한 값으로 기대 경로를 직접 만들고 응답이 정확히 같은 문자열인지 검사한다.
      const payload = { returnPath: input.returnPath, ...(input.intent === undefined ? {} : { intent: input.intent }) };
      const authorizationPath = `/api/auth/oauth/${input.provider}/continue?${new URLSearchParams(payload).toString()}`;
      return parsedMutation(`auth/oauth/${input.provider}/start`, payload, z.object({ authorizationPath: z.literal(authorizationPath) }).strict(), http);
    },
    retry: false,
  });
}
