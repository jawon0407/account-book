export type CredentialScanOptions = Readonly<{
  allowCsrfTokenKey?: boolean;
  publicEmail?: string;
}>;

export type SafeJsonParseResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false }>;

type AuthErrorCode = "AUTH_INVALID_CREDENTIALS" | "AUTH_SESSION_EXPIRED";

const authErrorMessages: Readonly<Record<AuthErrorCode, string>> = {
  AUTH_INVALID_CREDENTIALS: "The authentication input was rejected.",
  AUTH_SESSION_EXPIRED: "The session has expired.",
};
const compactJwt = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u;
const credentialLabel = /access.?token|refresh.?token|password|session.?selector|selector/iu;
const credentialOrCsrfLabel = /access.?token|refresh.?token|csrf.?token|password|session.?selector|selector/iu;
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * 응답 원문에 비밀값·토큰 이름·JWT 모양이 있는지 먼저 검사한다.
 * @param value - 테스트 프로세스에서만 보관하는 응답 문자열이다.
 * @param forbidden - 이미 알고 있는 비밀값. 빈 문자열은 검색에서 제외한다.
 * @param options - 공개 이메일과 CSRF 키의 좁은 예외다. JSON 경로 검사는 별도 함수가 담당한다.
 * @returns 누출 후보가 있으면 true. 원문을 출력하지 않는다.
 */
export function containsCredentialMaterial(
  value: string,
  forbidden: readonly string[] = [],
  options: CredentialScanOptions = {},
): boolean {
  const exactSecrets = forbidden.filter(
    (secret) => secret.length > 0 && secret !== options.publicEmail,
  );
  const labels = options.allowCsrfTokenKey === true ? credentialLabel : credentialOrCsrfLabel;
  return exactSecrets.some((secret) => value.includes(secret))
    || labels.test(value)
    || compactJwt.test(value);
}

/**
 * 파싱한 JSON을 재귀 순회해 인코딩/중첩으로 숨은 자격증명을 검사한다.
 * @param value - 안전하게 파싱한 JSON 값이다.
 * @param forbidden - 현재 응답에서 금지할 비밀값 목록이다.
 * @param options - user.email 및 루트 CSRF 키만 허용하는 endpoint별 예외다.
 * @returns 키/값에 비밀 자료가 있으면 true. 외부 출력이나 저장은 없다.
 */
export function containsCredentialMaterialInJson(
  value: unknown,
  forbidden: readonly string[] = [],
  options: CredentialScanOptions = {},
): boolean {
  return scanJsonValue(value, forbidden, options, []);
}

/**
 * JSON 파싱 오류 메시지에 원문이 남지 않도록 실패를 고정 결과로 바꾼다.
 * @param value - 알려진 비밀 자료 검사를 먼저 거친 응답 문자열이다.
 * @returns 성공은 {ok:true,value}, 실패는 {ok:false}. 파서 예외를 전파하지 않는다.
 */
export function parseJsonSafely(value: string): SafeJsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * CSRF 공개 응답의 정확한 단일 키와 문자열 길이를 검사한다.
 * @param value - 파싱된 응답 값이다.
 * @returns csrfToken만 있고 길이가 1~1024인 문자열이면 true. 객체를 출력하지 않는다.
 */
export function isCsrfResponse(value: unknown): value is Readonly<{ csrfToken: string }> {
  return hasExactKeys(value, ["csrfToken"])
    && typeof value.csrfToken === "string"
    && value.csrfToken.length >= 1
    && value.csrfToken.length <= 1024;
}

/**
 * 고정 인증 오류 코드·문구·UUID·재시도 여부·빈 fieldErrors를 검사한다.
 * @param value - 파싱된 공개 오류 응답이다.
 * @param code - 이번 테스트 분기에서 기대하는 두 허용 오류 코드 중 하나다.
 * @returns 정확한 키와 값이 모두 맞으면 true. assertion에 원문을 넘기지 않는다.
 */
export function isAuthErrorResponse(value: unknown, code: AuthErrorCode): boolean {
  return hasExactKeys(value, ["code", "fieldErrors", "message", "requestId", "retryable"])
    && value.code === code
    && value.message === authErrorMessages[code]
    && typeof value.requestId === "string"
    && canonicalUuid.test(value.requestId)
    && value.retryable === false
    && Array.isArray(value.fieldErrors)
    && value.fieldErrors.length === 0;
}

/**
 * 로그인 공개 사용자와 두 만료 시각의 구조·순서를 검사한다.
 * @param value - 파싱한 로그인 성공 응답이다.
 * @param expected - 합성 사용자 email/userId 객체다.
 * @returns 정확한 키·인증 상태·사용자 값과 정규 ISO 만료 시각 순서가 맞으면 true다.
 */
export function isSignInResponse(
  value: unknown,
  expected: Readonly<{ email: string; userId: string }>,
): boolean {
  if (!hasExactKeys(value, ["absoluteExpiresAt", "expiresAt", "user"])) return false;
  if (!hasExactKeys(value.user, ["email", "emailVerified", "id"])) return false;
  if (
    value.user.email !== expected.email
    || value.user.emailVerified !== true
    || value.user.id !== expected.userId
  ) {
    return false;
  }
  if (!isCanonicalIsoDate(value.expiresAt) || !isCanonicalIsoDate(value.absoluteExpiresAt)) return false;
  return Date.parse(value.absoluteExpiresAt) > Date.parse(value.expiresAt);
}

/**
 * 현재 사용자 응답의 정확한 세 키와 기대값을 검사한다.
 * @param value - 파싱한 /api/me 응답이다.
 * @param expected - 기대 email(또는 null)과 userId다.
 * @returns 세 공개 필드가 기대와 일치하면 true. 응답 diff나 상태 변경은 없다.
 */
export function isMeResponse(
  value: unknown,
  expected: Readonly<{ email: string | null; userId: string }>,
): boolean {
  return hasExactKeys(value, ["email", "emailVerified", "id"])
    && value.email === expected.email
    && value.emailVerified === (expected.email !== null)
    && value.id === expected.userId;
}

/**
 * 로그아웃 응답에 signedOut:true 하나만 있는지 검사한다.
 * @param value - 파싱한 로그아웃 응답이다.
 * @returns 정확한 단일 필드이면 true. 외부 부작용은 없다.
 */
export function isSignOutResponse(value: unknown): boolean {
  return hasExactKeys(value, ["signedOut"]) && value.signedOut === true;
}

/**
 * 현재 JSON 경로와 자식 값을 재귀 순회하여 비밀 자료를 찾는다.
 * @param value - 현재 노드 값이다.
 * @param forbidden - 해당 응답의 금지 문자열 목록이다.
 * @param options - 공개 이메일 및 루트 CSRF 키 예외다.
 * @param path - 현재 객체 키/배열 인덱스 경로다. user.email 예외 위치를 제한한다.
 * @returns 현재 값 또는 자식에 비밀 자료가 있으면 true. 파싱된 비순환 JSON을 전제로 한다.
 */
function scanJsonValue(
  value: unknown,
  forbidden: readonly string[],
  options: CredentialScanOptions,
  path: readonly string[],
): boolean {
  if (typeof value === "string") {
    const isAllowedPublicEmail = options.publicEmail !== undefined
      && value === options.publicEmail
      && path.length === 2
      && path[0] === "user"
      && path[1] === "email";
    const activeSecrets = isAllowedPublicEmail
      ? forbidden.filter((secret) => secret !== options.publicEmail)
      : forbidden;
    const scanOptions: CredentialScanOptions = options.allowCsrfTokenKey === true
      ? { allowCsrfTokenKey: true }
      : {};
    return containsCredentialMaterial(value, activeSecrets, scanOptions);
  }
  if (Array.isArray(value)) {
    return value.some((entry, index) => scanJsonValue(entry, forbidden, options, [...path, String(index)]));
  }
  if (!isRecord(value)) return false;
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key, path, options)) return true;
    if (scanJsonValue(entry, forbidden, options, [...path, key])) return true;
  }
  return false;
}

/**
 * 키의 비알파벳 문자를 제거하고 소문자로 바꿔 민감한 키를 판정한다.
 * @param key - 디코딩된 현재 객체 키다.
 * @param path - 부모 경로. 루트 CSRF 예외를 판정한다.
 * @param options - endpoint별 CSRF 키 허용 설정이다.
 * @returns 정규화한 키가 비밀번호·토큰·selector 목록에 있으면 true다.
 */
function isSensitiveKey(
  key: string,
  path: readonly string[],
  options: CredentialScanOptions,
): boolean {
  const normalized = key.replaceAll(/[^A-Za-z]/gu, "").toLowerCase();
  if (
    options.allowCsrfTokenKey === true
    && path.length === 0
    && normalized === "csrftoken"
  ) {
    return false;
  }
  return [
    "accesstoken",
    "refreshtoken",
    "password",
    "csrftoken",
    "sessionselector",
    "selector",
  ].includes(normalized);
}

/**
 * 객체 자체를 assertion에 노출하지 않고 own key가 계약과 정확히 일치하는지 검사한다.
 * @param value - 파싱된 JSON 후보 값이다.
 * @param keys - endpoint가 허용한 고정 키 목록이다.
 * @returns null/배열이 아닌 객체에 해당 키들만 있으면 true. prototype 검사는 하지 않는다.
 */
function hasExactKeys<const Key extends string>(
  value: unknown,
  keys: readonly Key[],
): value is Record<Key, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * null과 배열을 제외하여 JSON 객체 후보로 타입을 좁힌다.
 * @param value - 검사할 파싱값이다.
 * @returns null이 아닌 비배열 객체이면 true. prototype까지 검증하지 않는다.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 날짜를 파싱한 뒤 ISO 문자열로 되돌려 원문과 같은지 검사한다.
 * @param value - 공개 만료 시각 후보다.
 * @returns 유한한 시각이며 정규 UTC ISO 문자열과 정확히 같으면 true다.
 */
function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
