import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { DELEGATED_JWT_MAX_BYTES, DelegatedScopeSchema, type DelegatedScope } from "@account-book/contracts/internal-api";
import {
  ACCESS_TOKEN_VERIFIER,
  InvalidAccessTokenError,
  type AccessTokenVerifier,
} from "./jwt-verifier.js";
import type { AuthPrincipal } from "./principal.js";
import { DELEGATED_SCOPE } from "./delegated-scope.js";

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Reads one raw header field, rejecting duplicated or framework-coalesced evidence. */
function oneRawHeader(request: FastifyRequest, name: string): string | undefined {
  const rawHeaders = request.raw.rawHeaders;
  if (rawHeaders.length % 2 !== 0) throw new InvalidAccessTokenError();
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      const value = rawHeaders[index + 1];
      if (value === undefined) throw new InvalidAccessTokenError();
      values.push(value);
    }
  }
  if (values.length > 1) throw new InvalidAccessTokenError();
  return values[0];
}

function bearerToken(request: FastifyRequest): string {
  const value = oneRawHeader(request, "authorization");
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

/** Rejects body-capable framing before any token data is sent to the verifier. */
function requestIdAndFraming(request: FastifyRequest): string {
  if (request.method !== "GET") throw new InvalidAccessTokenError();
  if (oneRawHeader(request, "content-type") !== undefined || oneRawHeader(request, "transfer-encoding") !== undefined) {
    throw new InvalidAccessTokenError();
  }
  const contentLength = oneRawHeader(request, "content-length");
  if (contentLength !== undefined && contentLength !== "0") throw new InvalidAccessTokenError();
  const requestId = oneRawHeader(request, "x-request-id");
  if (requestId === undefined || !CANONICAL_UUID.test(requestId)) throw new InvalidAccessTokenError();
  return requestId;
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
    const token = bearerToken(request);
    const requestId = requestIdAndFraming(request);
    const requiredScope = routeScope(this.reflector, context);
    const target = request.raw.url;
    if (typeof target !== "string") throw new InvalidAccessTokenError();
    const principal: AuthPrincipal = await this.verifier.verify({
      token,
      request: { method: "GET", target, contentType: null, body: new Uint8Array(), requestId },
      requiredScope,
    });
    request.principal = principal;
    return true;
  }
}
