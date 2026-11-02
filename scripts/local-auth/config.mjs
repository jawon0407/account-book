import { generateKeyPairSync, randomBytes } from "node:crypto";

export const PROJECT_REF = "tjtamaazsilaegvvovhg";
const WEB_KEYS = ["APP_ORIGIN", "API_INTERNAL_URL", "AUTH_ADAPTER_MODE", "AUTH_ENABLED_PROVIDERS", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "AUTH_TOKEN_KEY_ID", "AUTH_TOKEN_KEY", "AUTH_CSRF_HMAC_KEY", "BFF_JWT_KEY_ID", "BFF_JWT_PRIVATE_KEY"];
const API_KEYS = ["API_HOST", "API_PORT", "API_DATABASE_URL", "BFF_AUTH_DISABLED", "BFF_JWT_ACCEPTED_KIDS", "BFF_JWT_PUBLIC_KEYS"];
const OS_KEYS = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]);

/**
 * 신규 개발 DB에서만 실행하도록 현재 상태를 검사합니다. 기존 자산은 삭제하거나 덮어쓰지 않습니다.
 * @param {{schemas:string[], roles:string[], currentUser:string, clientTls:boolean, databaseTls:boolean}} state 읽기 전용 사전조회 결과.
 */
export function assertEmptySetup(state) {
  if (state.currentUser !== "postgres" || state.clientTls !== true || state.databaseTls !== true ||
    !Array.isArray(state.schemas) || state.schemas.length !== 0 || !Array.isArray(state.roles) || state.roles.length !== 0) {
    throw new Error("LOCAL_AUTH_PREFLIGHT_FAILED");
  }
}

/** 잘못된 설정값·비밀번호를 반사하지 않고 고정 오류로 중단합니다. */
function invalid() { throw new Error("LOCAL_AUTH_CONFIG_INVALID"); }

/**
 * 승인된 개발 프로젝트의 관리자 Session pooler URI만 허용합니다.
 * @param {string} value 파일에서 읽은 관리자 URI. 출력/로그에 사용하지 않습니다.
 * @returns {URL} 검증된 주소. 다른 DB·임의 접속 옵션은 거부합니다.
 */
export function parseSetupUrl(value) {
  try {
    if (typeof value !== "string" || value.trim() !== value || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return invalid();
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      decodeURIComponent(url.username) !== `postgres.${PROJECT_REF}` || !url.password ||
      !/^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(url.hostname) ||
      url.port !== "5432" || url.pathname !== "/postgres" || url.hash || value.includes("#")) return invalid();
    for (const [key, val] of url.searchParams) {
      if (key !== "sslmode" || !["require", "verify-full"].includes(val)) return invalid();
    }
    return url;
  } catch { return invalid(); }
}

/**
 * 관리자 연결의 대상만 재사용하고 서로 다른 역할/비밀번호/키를 새로 만듭니다.
 * @param {{migrationUrl: string, caPath: string, publishableKey: string}} input 비밀 입력과 검증된 CA 파일 경로.
 * @returns {{web: Record<string,string>, api: Record<string,string>}} 디스크 보관/프로세스 주입용 설정. 반환값은 로그 금지.
 */
export function createLocalAuthConfig({ migrationUrl, caPath, publishableKey }) {
  const owner = parseSetupUrl(migrationUrl);
  if (typeof caPath !== "string" || !caPath || typeof publishableKey !== "string" || !/^sb_publishable_[A-Za-z0-9_-]+$/u.test(publishableKey)) return invalid();
  /** @param {string} role 사전에 고정한 로그인 역할명. 관리자 URL의 검색 옵션은 복사하지 않습니다. */
  function roleUrl(role) {
    const url = new URL(`postgresql://${owner.hostname}:5432/postgres`);
    url.username = `${role}.${PROJECT_REF}`;
    url.password = randomBytes(32).toString("base64url");
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("sslrootcert", caPath);
    return url.toString();
  }
  const kid = "local-auth-20260929";
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    web: {
      APP_ORIGIN: "https://localhost:3000", API_INTERNAL_URL: "http://127.0.0.1:3001",
      AUTH_ADAPTER_MODE: "supabase", AUTH_ENABLED_PROVIDERS: "[]", DATABASE_URL: roleUrl("app_bff_login"),
      SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`, SUPABASE_ANON_KEY: publishableKey,
      AUTH_TOKEN_KEY_ID: kid, AUTH_TOKEN_KEY: randomBytes(32).toString("base64url"),
      AUTH_CSRF_HMAC_KEY: randomBytes(32).toString("base64url"), BFF_JWT_KEY_ID: kid,
      BFF_JWT_PRIVATE_KEY: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    },
    api: {
      API_HOST: "127.0.0.1", API_PORT: "3001", API_DATABASE_URL: roleUrl("app_api"),
      BFF_AUTH_DISABLED: "false", BFF_JWT_ACCEPTED_KIDS: JSON.stringify([kid]),
      BFF_JWT_PUBLIC_KEYS: JSON.stringify({ [kid]: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url") }),
    },
  };
}

/**
 * 부모 환경에서 OS 실행 필수값만 가져오고 해당 역할의 허용 목록만 주입합니다.
 * @param {"web"|"api"} kind 실행할 서버 역할.
 * @param {Record<string,string>} config 해당 역할의 로컬 파일에서 읽은 설정.
 * @param {Record<string,string|undefined>} parent 부모 환경. 관리자/타 역할/Node 옵션은 상속하지 않습니다.
 * @returns {Record<string,string>} 자식 프로세스 전용 환경.
 */
export function childEnvironment(kind, config, parent) {
  const keys = kind === "web" ? WEB_KEYS : kind === "api" ? API_KEYS : invalid();
  // 기존 파일은 수정 없이 모두 비활성화한다. 부모 쉘의 활성화 값은 절대 상속하지 않는다.
  if (kind === "web" && config) {
    config = { AUTH_ENABLED_PROVIDERS: "[]", ...config };
    try {
      const providers = JSON.parse(config.AUTH_ENABLED_PROVIDERS);
      if (!Array.isArray(providers) || providers.some((value) => !["google", "kakao", "naver"].includes(value)) || new Set(providers).size !== providers.length) return invalid();
    } catch { return invalid(); }
  }
  if (!config || Object.keys(config).some((key) => !keys.includes(key)) || keys.some((key) => typeof config[key] !== "string" || !config[key])) return invalid();
  const env = Object.fromEntries(Object.entries(parent).filter(([key, value]) => OS_KEYS.has(key.toUpperCase()) && typeof value === "string"));
  return { ...env, ...config, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" };
}
