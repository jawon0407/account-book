import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { z } from "zod";

const SAFE_KEY_ID = /^[A-Za-z0-9._-]{1,128}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const ApiPortSchema = z.string().regex(/^[1-9][0-9]{0,4}$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535))
  .default(3001);

/** Immutable static public-key view used only for delegated API JWT verification. */
export type DelegatedJwtKeyring = Readonly<Record<string, KeyObject>>;

/** Immutable server-only settings accepted by the API delegated-JWT trust boundary. */
export type ApiEnvironment = Readonly<{
  apiHost: "127.0.0.1" | "0.0.0.0";
  apiPort: number;
  apiDatabaseUrl: string;
  bffAuthDisabled: boolean;
  bffJwtAcceptedKids: readonly string[];
  bffJwtPublicKeys: DelegatedJwtKeyring;
}>;

/**
 * 빈 문자열, 앞뒤 공백, 제어문자가 없는 환경 변수인지 검사한다.
 * @param value - 아직 신뢰하지 않는 환경 변수 원문.
 * @returns 안전한 문자열이면 true. 입력은 변경하지 않는다.
 */
function safeEnvironmentValue(value: string | undefined): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value
    && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
}

/**
 * 서버가 열 주소와 포트를 검사하고 생략한 값에는 로컬 기본값을 적용한다.
 * @param input - 환경 변수 목록. 호스트는 두 주소만, 포트는 1~65535만 허용한다.
 * @returns 검증한 apiHost와 숫자 apiPort.
 * @throws 허용 범위를 벗어나면 원문을 숨긴 API_CONFIGURATION_INVALID 오류.
 */
function parseListener(input: Readonly<Record<string, string | undefined>>): Pick<ApiEnvironment, "apiHost" | "apiPort"> {
  const apiHost = input.API_HOST ?? "127.0.0.1";
  const parsedPort = ApiPortSchema.safeParse(input.API_PORT);
  if ((apiHost !== "127.0.0.1" && apiHost !== "0.0.0.0") || !parsedPort.success) throw new Error("API_CONFIGURATION_INVALID");
  return { apiHost, apiPort: parsedPort.data };
}

/**
 * API 전용 app_api 계정의 PostgreSQL URL을 검사한다. 로컬이 아니면 허용된 SSL 모드가 필수다.
 * @param value - 비밀번호를 포함할 수 있어 로그에 남기면 안 되는 연결 문자열.
 * @returns 검증을 통과한 원래 문자열. DB에는 연결하지 않는다.
 * @throws 공백, 잘못된 URL·계정·SSL 설정이면 API_CONFIGURATION_INVALID 오류.
 */
function parseDatabaseUrl(value: string | undefined): string {
  if (!safeEnvironmentValue(value) || /[\s\p{White_Space}]/u.test(value)) throw new Error("API_CONFIGURATION_INVALID");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  // Supavisor는 DB 역할 뒤에 프로젝트 식별자를 붙여 tenant를 선택한다.
  // 임의 호스트나 다른 역할로 이 예외가 확장되지 않도록 주소와 포트를 함께 제한한다.
  const supavisorRole = /^app_api\.[a-z]{20}$/u.test(url.username)
    && /^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(url.hostname)
    && (url.port === "5432" || url.port === "6543");
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || (url.username !== "app_api" && !supavisorRole)
    || url.password === ""
    || url.hash !== ""
    || url.hostname === ""
  ) throw new Error("API_CONFIGURATION_INVALID");
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  const sslmodes = url.searchParams.getAll("sslmode");
  if (sslmodes.length > 1) throw new Error("API_CONFIGURATION_INVALID");
  const sslmode = sslmodes[0];
  const allowedModes = loopback ? ["disable", "require", "verify-ca", "verify-full"] : ["require", "verify-ca", "verify-full"];
  if ((sslmode !== undefined && !allowedModes.includes(sslmode)) || (!loopback && sslmode === undefined)) throw new Error("API_CONFIGURATION_INVALID");
  return value;
}

/**
 * 허용할 서명 키 식별자(kid)의 JSON 배열을 읽고 중복과 안전하지 않은 문자를 거부한다.
 * @param value - 1~3개의 키 식별자를 담은 JSON 문자열.
 * @returns 외부에서 배열을 바꾸지 못하도록 동결한 식별자 목록.
 * @throws 형식이나 개수가 맞지 않으면 API_CONFIGURATION_INVALID 오류.
 */
function parseAcceptedKids(value: string | undefined): readonly string[] {
  if (!safeEnvironmentValue(value)) throw new Error("API_CONFIGURATION_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 3 || !parsed.every((kid) => typeof kid === "string" && SAFE_KEY_ID.test(kid))) {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  if (new Set(parsed).size !== parsed.length) throw new Error("API_CONFIGURATION_INVALID");
  return Object.freeze([...parsed]);
}

/**
 * 키 식별자와 공개키 문자열만 담는 평평한 JSON 객체를 제한된 문법으로 읽는다.
 * JSON.parse가 같은 이름의 필드를 덮어쓰는 문제를 피하려고 항목을 직접 추출한다.
 * @param value - 1~3개 키 항목을 담은 설정 문자열.
 * @returns 중복 없는 [키 식별자, 인코딩된 공개키] 목록.
 * @throws 문법·개수·중복 검사에 실패하면 API_CONFIGURATION_INVALID 오류.
 */
function parseFlatKeyObject(value: string | undefined): readonly (readonly [string, string])[] {
  if (!safeEnvironmentValue(value)) throw new Error("API_CONFIGURATION_INVALID");
  const match = /^\{\s*(?:"([A-Za-z0-9._-]{1,128})"\s*:\s*"([A-Za-z0-9_-]+)"\s*)(?:,\s*"([A-Za-z0-9._-]{1,128})"\s*:\s*"([A-Za-z0-9_-]+)"\s*){0,2}\}$/u.exec(value);
  if (!match) throw new Error("API_CONFIGURATION_INVALID");
  const entries: [string, string][] = [[match[1]!, match[2]!]];
  const remainder = value.slice(value.indexOf(",") + 1);
  if (value.includes(",")) {
    const entriesPattern = /"([A-Za-z0-9._-]{1,128})"\s*:\s*"([A-Za-z0-9_-]+)"/gu;
    for (const entry of remainder.matchAll(entriesPattern)) entries.push([entry[1]!, entry[2]!]);
  }
  if (entries.length === 0 || entries.length > 3 || new Set(entries.map(([kid]) => kid)).size !== entries.length) throw new Error("API_CONFIGURATION_INVALID");
  return entries;
}

/**
 * base64url 문자열을 P-256 공개키로 읽고 다시 내보내 원본 바이트와 일치하는지 확인한다.
 * 개인키나 불필요한 후행 데이터가 섞인 DER는 허용하지 않는다.
 * @param value - SPKI DER 형식 공개키의 패딩 없는 base64url 문자열.
 * @returns 서명 검증에 사용할 Node 공개키 객체.
 * @throws 인코딩·키 종류·곡선이 다르면 API_CONFIGURATION_INVALID 오류.
 */
function parsePublicKey(value: string): KeyObject {
  if (!BASE64URL.test(value)) throw new Error("API_CONFIGURATION_INVALID");
  const der = Buffer.from(value, "base64url");
  if (der.length === 0 || der.toString("base64url") !== value) throw new Error("API_CONFIGURATION_INVALID");
  try {
    createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    throw new Error("API_CONFIGURATION_INVALID");
  } catch (error) {
    if (error instanceof Error && error.message === "API_CONFIGURATION_INVALID") throw error;
  }
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  const canonical = key.export({ format: "der", type: "spki" });
  if (!Buffer.from(canonical).equals(der) || key.type !== "public" || key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("API_CONFIGURATION_INVALID");
  }
  return key;
}

/**
 * 설정의 공개키들을 읽고 허용 목록의 모든 키가 실제로 존재하는지 확인한다.
 * @param value - 키 식별자별 공개키를 담은 JSON 문자열.
 * @param acceptedKids - API가 검증에 사용할 수 있는 키 식별자 목록.
 * @returns 항목을 추가하거나 교체할 수 없도록 동결한 공개키 목록.
 * @throws 공개키가 잘못되거나 허용 키가 없으면 API_CONFIGURATION_INVALID 오류.
 */
function parseKeyring(value: string | undefined, acceptedKids: readonly string[]): DelegatedJwtKeyring {
  const entries = parseFlatKeyObject(value);
  const keyring: Record<string, KeyObject> = {};
  for (const [kid, encoded] of entries) keyring[kid] = parsePublicKey(encoded);
  if (!acceptedKids.every((kid) => Object.hasOwn(keyring, kid))) throw new Error("API_CONFIGURATION_INVALID");
  return Object.freeze(keyring);
}

/**
 * 서버 환경 변수를 검사해 위임 JWT 검증에 필요한 설정으로 묶는다. DB 연결이나 서명 검증은 하지 않는다.
 * @param input - 아직 신뢰하지 않는 프로세스 환경 변수 목록.
 * @returns 주소, 포트, DB URL, 인증 중지 스위치, 허용 키를 담은 동결된 설정.
 * @throws 어떤 설정 검사든 실패하면 입력값이나 비밀번호 없는 API_CONFIGURATION_INVALID 오류.
 */
export function parseApiEnvironment(input: Readonly<Record<string, string | undefined>>): ApiEnvironment {
  try {
    const listener = parseListener(input);
    if (input.BFF_AUTH_DISABLED !== "true" && input.BFF_AUTH_DISABLED !== "false") throw new Error("API_CONFIGURATION_INVALID");
    const acceptedKids = parseAcceptedKids(input.BFF_JWT_ACCEPTED_KIDS);
    return Object.freeze({
      ...listener,
      apiDatabaseUrl: parseDatabaseUrl(input.API_DATABASE_URL),
      bffAuthDisabled: input.BFF_AUTH_DISABLED === "true",
      bffJwtAcceptedKids: acceptedKids,
      bffJwtPublicKeys: parseKeyring(input.BFF_JWT_PUBLIC_KEYS, acceptedKids),
    }) as ApiEnvironment;
  } catch {
    throw new Error("API_CONFIGURATION_INVALID");
  }
}

let cachedEnvironment: ApiEnvironment | undefined;

/**
 * 최초 호출 때 process.env를 검사해 보관하고 이후 호출에서는 같은 설정을 돌려준다.
 * @returns 한 프로세스에서 공유하는 동결된 API 설정.
 * @throws 최초 환경 변수 검사에 실패하면 고정된 설정 오류.
 * @remarks 캐시를 갱신하므로 실행 도중 환경 변수를 바꿔도 이미 읽은 설정은 바뀌지 않는다.
 */
export function getApiEnvironment(): ApiEnvironment {
  cachedEnvironment ??= parseApiEnvironment(process.env);
  return cachedEnvironment;
}
