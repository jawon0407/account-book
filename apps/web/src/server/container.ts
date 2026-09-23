import "server-only";

import {
  createHash,
  createPrivateKey,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import { createDatabaseClient } from "@account-book/database";
import { EmailAuthService } from "./auth/email-auth-service.js";
import { FakeAuthProvider } from "./auth/fake-auth-provider.js";
import { OAuthService } from "./auth/oauth-service.js";
import { PasswordRecoveryService } from "./auth/password-recovery-service.js";
import { SupabaseAuthAdapter } from "./auth/supabase-auth-adapter.js";
import { AuthController } from "./http/auth-controller.js";
import { DelegatedApiClient } from "./http/delegated-api-client.js";
import { PostgresAuthRepository } from "./persistence/postgres-auth-repository.js";
import { SessionService } from "./session/session-service.js";
import { DelegatedJwtSigner } from "./security/delegated-jwt-signer.js";
import type { TokenKeyring } from "./security/token-envelope.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
let sharedDatabase: ReturnType<typeof createDatabaseClient> | undefined;
let sharedDatabaseFingerprint: string | undefined;

/** The only authentication adapter modes permitted by the server container. */
export type AuthAdapterMode = "supabase" | "fake";

/** Canonical application origin and validated adapter choice. */
export type AuthRuntime = Readonly<{ mode: AuthAdapterMode; origin: URL }>;

/**
 * 환경변수·키·연결 문자열을 오류에 담지 않고 설정 실패를 알립니다.
 * @returns 반환하지 않습니다.
 * @throws AUTH_CONFIGURATION_INVALID.
 */
function invalidConfiguration(): never {
  throw new Error("AUTH_CONFIGURATION_INVALID");
}

/**
 * 앱 출처를 정확한 origin 문자열로 제한합니다. 운영에서는 HTTPS, 비운영 로컬에서만 HTTP를 허용합니다.
 * @param value APP_ORIGIN 후보.
 * @param production 운영 환경인지 여부.
 * @returns 검증된 URL.
 * @throws 공백·경로·인증정보·스킴 등이 잘못되면 설정 오류.
 */
function canonicalOrigin(value: unknown, production: boolean): URL {
  if (typeof value !== "string" || value.trim() !== value) return invalidConfiguration();
  let origin: URL;
  try { origin = new URL(value); } catch { return invalidConfiguration(); }
  const loopback = LOOPBACK_HOSTS.has(origin.hostname);
  if (
    origin.username !== "" || origin.password !== "" || origin.pathname !== "/" || origin.search !== "" || origin.hash !== "" ||
    !(origin.protocol === "https:" || (!production && loopback && origin.protocol === "http:")) || origin.origin !== value
  ) return invalidConfiguration();
  return origin;
}

/**
 * Resolves the adapter without allowing fake authentication on production or public hosts.
 * @param environment - Server-only environment values; only mode, node environment, and canonical origin are inspected.
 * @returns The strict adapter mode and cloned canonical origin.
 * @throws `AUTH_CONFIGURATION_INVALID` for a missing/unsafe origin or disallowed adapter mode.
 */
/**
 * 환경에서 실제/가짜 인증 모드를 선택하며 가짜 제공자는 비운영 로컬 호스트에서만 허용합니다.
 * @param environment 서버 환경변수; 인증 모드·NODE_ENV·앱 출처를 읽습니다.
 * @returns 허용된 어댑터 모드와 검증된 앱 출처.
 * @throws 알 수 없는 모드·안전하지 않은 출처이면 설정 오류.
 */
export function resolveAuthRuntime(environment: Readonly<Record<string, string | undefined>>): AuthRuntime {
  const production = environment.NODE_ENV === "production";
  const origin = canonicalOrigin(environment.APP_ORIGIN, production);
  const modeValue = environment.AUTH_ADAPTER_MODE ?? "supabase";
  if (modeValue !== "supabase" && modeValue !== "fake") return invalidConfiguration();
  if (modeValue === "fake" && (production || !LOOPBACK_HOSTS.has(origin.hostname))) return invalidConfiguration();
  return { mode: modeValue, origin };
}

/**
 * 필수 환경변수가 비어 있지 않고 앞뒤 공백·제어문자가 없는지 검사합니다.
 * @param environment 서버 환경변수 객체.
 * @param name 읽을 변수 이름.
 * @returns 검증된 문자열.
 * @throws 누락 또는 문자열 형식 오류.
 */
function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return invalidConfiguration();
  return value;
}

/**
 * URL의 스킴·해시와 선택적 루트 경로 제한을 검사합니다. HTTP 지원 정책일 때는 URL 인증정보도 금지합니다.
 * @param value 서버 URL 문자열.
 * @param protocols 허용할 URL 프로토콜 집합.
 * @param rootOnly 루트 경로 및 쿼리 부재를 요구할지 여부.
 * @returns 검증된 URL.
 * @throws 조건에 맞지 않으면 설정 오류.
 */
function serverUrl(value: string, protocols: ReadonlySet<string>, rootOnly: boolean): URL {
  let url: URL;
  try { url = new URL(value); } catch { return invalidConfiguration(); }
  if (!protocols.has(url.protocol) || url.hash !== "" || (rootOnly && (url.pathname !== "/" || url.search !== ""))) return invalidConfiguration();
  if (protocols.has("http:") && (url.username !== "" || url.password !== "")) return invalidConfiguration();
  return url;
}

/**
 * 테스트 제공자 주소를 정확히 로컬 127.0.0.1:4510의 /token으로 제한합니다.
 * @param value 테스트 제공자 URL 문자열.
 * @returns 검증된 로컬 URL.
 * @throws 주소·포트·경로·표기가 다르면 설정 오류.
 */
function fakeProviderUrl(value: string): URL {
  const url = serverUrl(value, new Set(["http:"]), false);
  if (url.toString() !== value || url.hostname !== "127.0.0.1" || url.port !== "4510" || url.pathname !== "/token" || url.search !== "") return invalidConfiguration();
  return url;
}

/**
 * 키 문자열이 표준 base64url로 표현된 정확한 32바이트인지 확인합니다.
 * @param value 인코딩된 서버 키.
 * @returns 해독한 32바이트 키.
 * @throws 표기나 길이가 다르면 설정 오류.
 */
function canonicalKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return invalidConfiguration();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) return invalidConfiguration();
  return decoded;
}

/**
 * 현재 암호화 키와 JSON 형식의 이전 키 목록을 읽고 ID 중복·키 형식을 검사합니다.
 * @param environment 토큰 암호화 키 관련 서버 환경변수.
 * @returns 현재 키 ID와 복호화 가능한 키 Map.
 * @throws 키 목록 JSON·ID·키 바이트가 잘못되면 설정 오류.
 */
function keyring(environment: Readonly<Record<string, string | undefined>>): TokenKeyring {
  const currentKeyId = required(environment, "AUTH_TOKEN_KEY_ID");
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(currentKeyId)) return invalidConfiguration();
  const keys = new Map<string, Uint8Array>([[currentKeyId, canonicalKey(required(environment, "AUTH_TOKEN_KEY"))]]);
  const previous = environment.AUTH_TOKEN_PREVIOUS_KEYS;
  if (previous !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(previous); } catch { return invalidConfiguration(); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return invalidConfiguration();
    for (const [keyId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9._-]{1,128}$/u.test(keyId) || keyId === currentKeyId || typeof value !== "string") return invalidConfiguration();
      keys.set(keyId, canonicalKey(value));
    }
  }
  return { currentKeyId, keys };
}

/**
 * Parses one canonical PKCS8 DER base64url value and accepts only a P-256 EC private key.
 * @param environment Server-only values containing the dedicated delegated-JWT key and its rotation ID.
 * @param tokenKeyring Validated current and previous app-token keys that the signing scalar must not reuse.
 * @param csrfKey Validated CSRF HMAC key that the signing scalar must not reuse.
 * @returns A validated key ID and private `KeyObject` suitable only for ES256 signing.
 * @throws `AUTH_CONFIGURATION_INVALID` without secret or parser detail for every malformed or unsafe value.
 */
/**
 * PKCS8 DER 키를 파싱해 표준 인코딩·P-256 개인키인지 확인하고 암호화/CSRF 대칭키를 재사용하지 않았는지 검사합니다.
 * @param environment 위임 JWT 키·키 ID 환경변수.
 * @param tokenKeyring 현재 및 이전 토큰 암호화 키.
 * @param csrfKey CSRF HMAC 키.
 * @returns 변경 불가 키 ID와 개인 KeyObject.
 * @throws 잘못된 키·인코딩·키 재사용이면 세부값 없는 설정 오류.
 */
function delegatedSigningKey(
  environment: Readonly<Record<string, string | undefined>>,
  tokenKeyring: TokenKeyring,
  csrfKey: Uint8Array,
): Readonly<{ keyId: string; privateKey: KeyObject }> {
  const keyId = required(environment, "BFF_JWT_KEY_ID");
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(keyId)) return invalidConfiguration();
  const encoded = required(environment, "BFF_JWT_PRIVATE_KEY");
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return invalidConfiguration();
  const der = Buffer.from(encoded, "base64url");
  if (der.length === 0 || der.toString("base64url") !== encoded) return invalidConfiguration();
  let privateKey: KeyObject;
  let canonicalDer: Buffer;
  let privateScalar: Uint8Array;
  try {
    privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    canonicalDer = privateKey.export({ format: "der", type: "pkcs8" });
    const jwk = privateKey.export({ format: "jwk" });
    if (typeof jwk.d !== "string") return invalidConfiguration();
    privateScalar = canonicalKey(jwk.d);
  } catch {
    return invalidConfiguration();
  }
  if (
    !canonicalDer.equals(der) ||
    privateKey.type !== "private" ||
    privateKey.asymmetricKeyType !== "ec" ||
    privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    return invalidConfiguration();
  }
  let reusedSymmetricKey = false;
  for (const activeKey of [csrfKey, ...tokenKeyring.keys.values()]) {
    reusedSymmetricKey = timingSafeEqual(privateScalar, activeKey) || reusedSymmetricKey;
  }
  if (reusedSymmetricKey) return invalidConfiguration();
  return Object.freeze({ keyId, privateKey });
}

/**
 * 프로세스에서 첫 DB 클라이언트를 만들어 재사용합니다. 연결 문자열 자체 대신 해시를 비교해 중간 설정 변경을 거부합니다.
 * @param connectionString 서버 DB 연결 문자열.
 * @returns 프로세스 공유 DB 클라이언트.
 * @throws 기존과 다른 연결 문자열 또는 DB 클라이언트 생성 실패.
 */
function databaseClient(connectionString: string): ReturnType<typeof createDatabaseClient> {
  const fingerprint = createHash("sha256").update(connectionString).digest("base64url");
  if (sharedDatabase === undefined) {
    sharedDatabase = createDatabaseClient(connectionString);
    sharedDatabaseFingerprint = fingerprint;
  } else if (sharedDatabaseFingerprint !== fingerprint) {
    return invalidConfiguration();
  }
  return sharedDatabase;
}

/**
 * The request-owned dependency graph exposed to route adapters.
 * The exposed signer feeds the exposed request-owned client, and the controller receives that exact client.
 */
export type RequestContainer = Readonly<{
  authController: AuthController;
  delegatedApiClient: DelegatedApiClient;
  delegatedJwtSigner: DelegatedJwtSigner;
}>;

/**
 * Reuses one process-scoped infrastructure database client while constructing fresh request-scoped repository, provider, session, use-case, and HTTP objects.
 * @param environment - Complete server-only runtime environment; secrets are parsed but never retained in errors.
 * @returns A request-owned controller graph with no user session cached at module scope.
 * @throws `AUTH_CONFIGURATION_INVALID` before constructing an adapter when any required value is unsafe.
 */
/**
 * DB 연결만 프로세스에서 공유하고 저장소·인증 제공자·세션·업무 서비스·서명기·HTTP 컨트롤러는 요청마다 새로 연결합니다.
 * @param environment 서버 환경변수; 기본값은 process.env.
 * @returns 해당 요청 전용 컨트롤러·위임 클라이언트·서명기.
 * @throws 설정 및 의존성 생성 실패를 AUTH_CONFIGURATION_INVALID로 통일합니다.
 */
export function createRequestContainer(environment: Readonly<Record<string, string | undefined>> = process.env): RequestContainer {
  try {
    const runtime = resolveAuthRuntime(environment);
    const databaseUrl = serverUrl(required(environment, "DATABASE_URL"), new Set(["postgres:", "postgresql:"]), false).toString();
    const apiInternalUrl = serverUrl(required(environment, "API_INTERNAL_URL"), new Set(["http:", "https:"]), true);
    const tokenKeyring = keyring(environment);
    const csrfKey = canonicalKey(required(environment, "AUTH_CSRF_HMAC_KEY"));
    const signingKey = delegatedSigningKey(environment, tokenKeyring, csrfKey);
    const repository = new PostgresAuthRepository(databaseClient(databaseUrl));
    const provider = runtime.mode === "fake"
      ? new FakeAuthProvider(environment.AUTH_FAKE_PROVIDER_URL === undefined ? undefined : { tokenUrl: fakeProviderUrl(required(environment, "AUTH_FAKE_PROVIDER_URL")) })
      : new SupabaseAuthAdapter({
          url: serverUrl(required(environment, "SUPABASE_URL"), new Set(["http:", "https:"]), true).toString(),
          anonKey: required(environment, "SUPABASE_ANON_KEY"),
        });
    const sessions = new SessionService(repository, tokenKeyring, async (refreshToken) => provider.refresh(refreshToken));
    const email = new EmailAuthService(provider, sessions, repository, tokenKeyring);
    const oauth = new OAuthService(repository, provider, sessions, tokenKeyring);
    const recovery = new PasswordRecoveryService(repository, provider, tokenKeyring);
    const delegatedJwtSigner = new DelegatedJwtSigner({
      keyId: signingKey.keyId,
      privateKey: signingKey.privateKey,
      now: () => new Date(),
    });
    const delegatedApiClient = new DelegatedApiClient(apiInternalUrl, delegatedJwtSigner);
    const authController = new AuthController({
      configuredOrigin: runtime.origin,
      secureCookies: true,
      csrfKey,
      now: () => new Date(),
      email,
      oauth,
      recovery,
      sessions,
      provider,
      delegatedApiClient,
    });
    return {
      delegatedJwtSigner,
      delegatedApiClient,
      authController,
    };
  } catch {
    return invalidConfiguration();
  }
}
