import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import {
  DELEGATED_JSON_BODY_MAX_BYTES,
  DELEGATED_JWT_MAX_BYTES,
  DelegatedScopeSchema,
  normalizeDelegatedContentType,
  type DelegatedScope,
} from "@account-book/contracts/internal-api";
import {
  ACCESS_TOKEN_VERIFIER,
  InvalidAccessTokenError,
  type AccessTokenVerifier,
} from "./jwt-verifier.js";
import type { AuthPrincipal } from "./principal.js";
import { DELEGATED_SCOPE } from "./delegated-scope.js";

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
type GuardRequest = Readonly<{
  method: "GET" | "POST" | "PATCH" | "DELETE";
  target: string;
  contentType: string | null;
  body: Uint8Array;
  requestId: string;
}>;

/**
 * 프레임워크가 합치기 전의 원시 HTTP 헤더를 읽어 소문자 이름으로 묶는다.
 * @param request - Node 원시 헤더 배열이 있는 Fastify 요청.
 * @returns 중복 이름이 없는 헤더 맵. 요청 자체는 변경하지 않는다.
 * @throws 배열 구조가 잘못되거나 헤더 이름이 중복되면 InvalidAccessTokenError.
 */
function rawHeaderMap(request: FastifyRequest): ReadonlyMap<string, string> {
  const rawHeaders = request.raw.rawHeaders;
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0) throw new InvalidAccessTokenError();
  const headers = new Map<string, string>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (typeof name !== "string" || typeof value !== "string") throw new InvalidAccessTokenError();
    const normalizedName = name.toLowerCase();
    if (headers.has(normalizedName)) throw new InvalidAccessTokenError();
    headers.set(normalizedName, value);
  }
  return headers;
}

/**
 * Authorization에서 정확한 Bearer 형식의 JWT만 꺼낸다. 아직 서명을 신뢰하지 않는다.
 * @param headers - 중복 검사가 끝난 소문자 헤더 맵.
 * @returns Bearer 접두사를 제외한 토큰 문자열.
 * @throws 헤더 누락, 크기 초과, 제어문자, 형식 오류이면 InvalidAccessTokenError.
 */
function bearerToken(headers: ReadonlyMap<string, string>): string {
  const value = headers.get("authorization");
  if (
    value === undefined
    || Buffer.byteLength(value, "utf8") > DELEGATED_JWT_MAX_BYTES + "Bearer ".length
    || Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) throw new InvalidAccessTokenError();
  const match = BEARER.exec(value);
  if (match?.[1] === undefined) throw new InvalidAccessTokenError();
  return match[1];
}

/**
 * 요청 ID, 메서드, 본문 길이와 콘텐츠 유형을 검사해 JWT와 비교할 요청 정보를 만든다.
 * GET은 본문과 Content-Type을 금지하며 변경 요청은 제한 크기 안의 JSON 본문을 요구한다.
 * @param request - 원시 URL과 검증용 본문 바이트를 가진 요청.
 * @param headers - 중복 검사를 통과한 원시 헤더 맵.
 * @returns 서명에 묶일 요청 정보. 본문 해시는 다음 검증 단계에서 계산한다.
 * @throws 전송 방식이나 길이가 모호하거나 허용되지 않은 메서드이면 InvalidAccessTokenError.
 */
function requestIdAndFraming(request: FastifyRequest, headers: ReadonlyMap<string, string>): GuardRequest {
  const requestId = headers.get("x-request-id");
  if (requestId === undefined || !CANONICAL_UUID.test(requestId)) throw new InvalidAccessTokenError();
  if (headers.has("transfer-encoding")) throw new InvalidAccessTokenError();

  const rawBody = request.rawBody;
  if (rawBody !== undefined && !(rawBody instanceof Uint8Array)) throw new InvalidAccessTokenError();
  const body = rawBody ?? new Uint8Array();
  const contentLength = headers.get("content-length");
  if (
    contentLength !== undefined
    && (!CANONICAL_DECIMAL.test(contentLength) || BigInt(contentLength) !== BigInt(body.byteLength))
  ) {
    throw new InvalidAccessTokenError();
  }
  const target = request.raw.url;
  if (typeof target !== "string") throw new InvalidAccessTokenError();

  if (request.method === "GET") {
    if (headers.has("content-type") || body.byteLength !== 0) throw new InvalidAccessTokenError();
    return { method: "GET", target, contentType: null, body, requestId };
  }
  if (request.method !== "POST" && request.method !== "PATCH" && request.method !== "DELETE") {
    throw new InvalidAccessTokenError();
  }
  if (rawBody === undefined || body.byteLength === 0 || body.byteLength > DELEGATED_JSON_BODY_MAX_BYTES) {
    throw new InvalidAccessTokenError();
  }
  try {
    if (normalizeDelegatedContentType(headers.get("content-type") ?? null) !== "application/json") {
      throw new InvalidAccessTokenError();
    }
  } catch {
    throw new InvalidAccessTokenError();
  }
  return { method: request.method, target, contentType: "application/json", body, requestId };
}

/**
 * 컨트롤러·메서드 메타데이터에서 해당 경로에 필요한 위임 권한을 읽는다.
 * @param reflector - Nest 메타데이터 조회기.
 * @param context - 실행할 메서드와 컨트롤러 정보.
 * @returns 공유 계약에 정의된 권한 이름 하나.
 * @throws 권한 선언이 없거나 잘못되면 기본 권한을 주지 않고 InvalidAccessTokenError.
 */
function routeScope(reflector: Reflector, context: ExecutionContext): DelegatedScope {
  const scope = reflector.getAllAndOverride<unknown>(DELEGATED_SCOPE, [context.getHandler(), context.getClass()]);
  const parsed = DelegatedScopeSchema.safeParse(scope);
  if (!parsed.success) throw new InvalidAccessTokenError();
  return parsed.data;
}

/**
 * 헤더 구조와 본문을 먼저 검사하고 JWT 검증이 모두 끝난 뒤에만 사용자 정보를 요청에 붙인다.
 * 이 가드는 사용자 식별 경계이며 금융 자원의 소유권 조회를 구현하지는 않는다.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /**
   * 요청 검증기와 경로 권한 조회기를 주입받는다. 생성 시 인증이나 DB 쓰기는 하지 않는다.
   * @param verifier - 검증된 사용자 정보를 만들어 낼 유일한 검증기.
   * @param reflector - 경로에 선언된 위임 권한을 읽는 Nest 도구.
   */
  public constructor(
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    private readonly reflector: Reflector,
  ) {}

  /**
   * 원시 헤더, 요청 형태, 경로 권한을 확인하고 토큰 검증 결과를 request.principal에 저장한다.
   * @param context - Fastify 요청이 들어 있는 Nest HTTP 실행 문맥.
   * @returns 모든 검사와 재사용 차단 저장이 성공했을 때만 true.
   * @throws 잘못된 인증 입력 또는 검증기 운영 오류. 실패한 검증 결과는 요청에 저장하지 않는다.
   */
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const headers = rawHeaderMap(request);
    const token = bearerToken(headers);
    const guardedRequest = requestIdAndFraming(request, headers);
    const requiredScope = routeScope(this.reflector, context);
    const principal: AuthPrincipal = await this.verifier.verify({
      token,
      request: guardedRequest,
      requiredScope,
    });
    request.principal = principal;
    return true;
  }
}
