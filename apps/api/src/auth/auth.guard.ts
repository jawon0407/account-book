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

/** Reads raw header pairs once, rejecting duplicate evidence before framework normalization. */
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

/** Builds the exact request descriptor from raw Fastify evidence, rejecting ambiguous framing. */
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

/** Resolves only a contract-valid route capability, failing closed for missing metadata. */
function routeScope(reflector: Reflector, context: ExecutionContext): DelegatedScope {
  const scope = reflector.getAllAndOverride<unknown>(DELEGATED_SCOPE, [context.getHandler(), context.getClass()]);
  const parsed = DelegatedScopeSchema.safeParse(scope);
  if (!parsed.success) throw new InvalidAccessTokenError();
  return parsed.data;
}

/**
 * Establishes the request principal from exactly one canonical Bearer JWT.
 * Header cardinality, byte/control checks, and syntax checks run before cryptographic verification;
 * the request remains unauthenticated on every failure.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /** @param verifier - The sole authority allowed to derive an authenticated principal. */
  public constructor(
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Validates the raw Authorization header before attaching a verified principal.
   * @param context - Nest HTTP execution context containing the Fastify request.
   * @returns `true` only after the verifier has returned a valid principal.
   * @throws A fixed failure for malformed or invalid input; no partial principal is attached.
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
