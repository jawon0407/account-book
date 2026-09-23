import { z } from "zod";

export const DELEGATED_JWT_ISSUER = "urn:account-book:bff";
export const DELEGATED_JWT_AUDIENCE = "urn:account-book:api";
export const DELEGATED_JWT_TTL_SECONDS = 30;
export const DELEGATED_JWT_REPLAY_SECONDS = 45;
export const DELEGATED_JWT_MAX_BYTES = 4096;

/** Single JSON body limit for Fastify's parser and guard, keeping their validation boundary aligned. */
export const DELEGATED_JSON_BODY_MAX_BYTES = 32_768;

/** Restricts `scope` to the least-privilege capability the BFF may exercise, not a general user role. */
export const DelegatedScopeSchema = z.enum([
  "me:read",
  "account:read",
  "account:write",
  "category:read",
  "category:write",
  "transaction:read",
  "transaction:write",
  "dashboard:read",
]);
export type DelegatedScope = z.infer<typeof DelegatedScopeSchema>;

const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DigestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const RequestIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
);

export type DelegatedRequestInput = Readonly<{
  method: z.infer<typeof MethodSchema>;
  target: string;
  contentType: string | null;
  bodySha256: string;
  requestId: string;
}>;

/**
 * 요청 정규화 실패를 입력 내용 없는 하나의 오류로 통일한다.
 * @returns 정상 반환하지 않는다.
 * @throws 항상 DELEGATED_REQUEST_INVALID 오류.
 */
function invalid(): never {
  throw new Error("DELEGATED_REQUEST_INVALID");
}

/**
 * 같은 JSON 콘텐츠 유형의 허용 표기를 통일해 BFF와 API가 같은 서명 대상 문자열을 만들게 한다.
 * @param value - 원시 Content-Type 헤더. 헤더가 없으면 null.
 * @returns 부재는 빈 문자열, 허용 JSON은 application/json. 입력은 변경하지 않는다.
 * @throws 제어문자, 지원하지 않는 유형이나 매개변수이면 DELEGATED_REQUEST_INVALID 오류.
 */
export function normalizeDelegatedContentType(value: string | null): "" | "application/json" {
  if (value === null) return "";
  if (Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return invalid();
  const normalized = value.trim().toLowerCase();
  if (normalized === "application/json" || normalized === "application/json; charset=utf-8") return "application/json";
  return invalid();
}

/**
 * 메서드·정규화 URL·콘텐츠 유형·본문 해시·요청 ID를 줄바꿈으로 이어 요청 결합 문자열을 만든다.
 * URL 쿼리 키를 정렬해 런타임 양쪽이 같은 표현을 사용하게 하며 외부 호스트와 fragment는 거부한다.
 * @param input - 위임 JWT에 묶을 요청 정보. 본문 해시는 호출자가 이미 계산해야 한다.
 * @returns 다섯 필드를 줄바꿈으로 연결한 문자열. 이 함수는 해시나 서명을 계산하지 않는다.
 * @throws 메서드·해시·UUID·URL·콘텐츠 유형이 허용 범위를 벗어나면 고정 요청 오류.
 */
export function canonicalDelegatedRequest(input: DelegatedRequestInput): string {
  const method = MethodSchema.safeParse(input.method);
  const digest = DigestSchema.safeParse(input.bodySha256);
  const requestId = RequestIdSchema.safeParse(input.requestId);
  if (!method.success || !digest.success || !requestId.success || !input.target.startsWith("/")) return invalid();
  let url: URL;
  try {
    url = new URL(input.target, "https://internal.invalid");
  } catch {
    return invalid();
  }
  if (url.origin !== "https://internal.invalid" || url.hash !== "" || url.username !== "" || url.password !== "") return invalid();
  url.searchParams.sort();
  const query = url.searchParams.toString();
  const target = `${url.pathname}${query === "" ? "" : `?${query}`}`;
  return [method.data, target, normalizeDelegatedContentType(input.contentType), digest.data, requestId.data].join("\n");
}
