import type { DelegatedScope } from "@account-book/contracts/internal-api";
import type { DelegatedSignInput } from "../security/delegated-jwt-signer.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

export type DelegatedApiRequest = Readonly<{
  body: Uint8Array;
  contentType: null | "application/json";
  method: "GET" | "POST" | "PATCH" | "DELETE";
  scope: DelegatedScope;
  sessionId: string;
  target: `/${string}`;
  userId: string;
}>;

export type DelegatedJwtSignerPort = Readonly<{
  /**
   * 정확한 내부 요청 내용에 묶인 서명 자격 증명을 만드는 최소 경계입니다.
   * @param input 전송할 요청·사용자·세션·권한.
   * @returns 같은 요청의 ID와 JWT.
   * @throws 서명 입력 또는 키 관련 오류.
   */
  sign(input: DelegatedSignInput): Promise<Readonly<{ requestId: string; token: string }>>;
}>;

/**
 * 잘못된 서버 URL 설정의 세부값 없이 중단합니다.
 * @returns 반환하지 않습니다.
 * @throws AUTH_CONFIGURATION_INVALID.
 */
function invalidConfiguration(): never {
  throw new Error("AUTH_CONFIGURATION_INVALID");
}

/**
 * 외부에 요청 내용을 반사하지 않고 잘못된 위임 요청을 거부합니다.
 * @returns 반환하지 않습니다.
 * @throws DELEGATED_API_REQUEST_INVALID.
 */
function invalidRequest(): never {
  throw new Error("DELEGATED_API_REQUEST_INVALID");
}

/**
 * 서명·전송 실패를 세부값 없는 가용성 오류로 통일합니다.
 * @returns 반환하지 않습니다.
 * @throws DELEGATED_API_UNAVAILABLE.
 */
function unavailable(): never {
  throw new Error("DELEGATED_API_UNAVAILABLE");
}

/**
 * 기본 API URL을 HTTPS 또는 로컬 HTTP 루트로 제한하고 인증정보·쿼리·해시를 금지합니다.
 * @param input 서버 설정에서 받은 URL.
 * @returns 검증된 URL 복사본.
 * @throws 잘못된 URL이면 AUTH_CONFIGURATION_INVALID.
 */
function validatedBaseUrl(input: URL): URL {
  try {
    if (!(input instanceof URL)) return invalidConfiguration();
    const serialized = input.toString();
    if (serialized.includes("?") || serialized.includes("#")) return invalidConfiguration();
    const baseUrl = new URL(serialized);
    const loopbackHttp = baseUrl.protocol === "http:" && LOOPBACK_HOSTS.has(baseUrl.hostname);
    if (
      !(baseUrl.protocol === "https:" || loopbackHttp) ||
      baseUrl.username !== "" ||
      baseUrl.password !== "" ||
      baseUrl.pathname !== "/" ||
      baseUrl.search !== "" ||
      baseUrl.hash !== ""
    ) {
      return invalidConfiguration();
    }
    return baseUrl;
  } catch {
    return invalidConfiguration();
  }
}

/**
 * 메서드·본문·콘텐츠 타입 조합을 확인하고 절대 경로를 기본 URL과 합쳐 같은 출처인지 검증합니다.
 * @param input 전송할 위임 요청.
 * @param baseUrl 검증된 API 기본 URL.
 * @returns 검증된 요청 대상 URL.
 * @throws 잘못된 입력이나 출처 이탈이면 DELEGATED_API_REQUEST_INVALID.
 */
function validatedTarget(input: DelegatedApiRequest, baseUrl: URL): URL {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      !METHODS.has(input.method) ||
      !(input.body instanceof Uint8Array) ||
      typeof input.target !== "string" ||
      !input.target.startsWith("/") ||
      input.target.startsWith("//") ||
      input.target.includes("#")
    ) {
      return invalidRequest();
    }
    if (input.method === "GET") {
      if (input.body.byteLength !== 0 || input.contentType !== null) return invalidRequest();
    } else if (input.body.byteLength === 0 || input.contentType !== "application/json") {
      return invalidRequest();
    }
    const target = new URL(input.target, baseUrl);
    if (
      target.origin !== baseUrl.origin ||
      target.username !== "" ||
      target.password !== "" ||
      target.hash !== ""
    ) {
      return invalidRequest();
    }
    return target;
  } catch {
    return invalidRequest();
  }
}

/**
 * Signs and sends one already-serialized internal API request without accepting browser-owned headers.
 * Caller-owned bytes are snapshotted before signing, then that exact internal body instance is shared with
 * the signer and fetch implementation so mutation during the signing await cannot drift the JWT binding.
 */
export class DelegatedApiClient {
  private readonly baseUrl: URL;

  /**
   * API 기본 URL을 검증하고 요청 서명기와 HTTP 전송 함수를 연결합니다.
   * @param baseUrl 신뢰된 내부 API 기본 URL.
   * @param signer 요청별 JWT 발급 기능.
   * @param fetcher HTTP 전송 함수; 기본은 fetch.
   * @throws 기본 URL이 안전하지 않으면 설정 오류.
   */
  public constructor(
    baseUrl: URL,
    private readonly signer: DelegatedJwtSignerPort,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = validatedBaseUrl(baseUrl);
  }

  /**
   * 본문 바이트를 복사한 뒤 그 정확한 내용으로 JWT를 서명하고 새 Authorization·요청 ID 헤더로 전송합니다. 3초 제한을 적용합니다.
   * @param input 미리 직렬화된 내부 요청·권한·사용자·세션.
   * @returns 내부 API의 원시 Response; 본문 검증은 호출자가 합니다.
   * @throws 검증 실패는 요청 오류, 서명·전송 실패는 가용성 오류.
   */
  public async request(input: DelegatedApiRequest): Promise<Response> {
    const target = validatedTarget(input, this.baseUrl);
    const request = Object.freeze({ ...input, body: Uint8Array.from(input.body) });
    try {
      const signed = await this.signer.sign(request);
      const headers: Record<string, string> = {
        accept: "application/json",
        authorization: `Bearer ${signed.token}`,
        "x-request-id": signed.requestId,
      };
      if (request.contentType !== null) headers["content-type"] = request.contentType;
      return await this.fetcher(target, {
        method: request.method,
        headers,
        ...(request.method === "GET" ? {} : { body: request.body as BodyInit }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      return unavailable();
    }
  }
}
