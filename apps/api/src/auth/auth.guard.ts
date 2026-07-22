import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  ACCESS_TOKEN_VERIFIER,
  InvalidAccessTokenError,
  type AccessTokenVerifier,
} from "./jwt-verifier.js";
import type { AuthPrincipal } from "./principal.js";

const MAX_AUTHORIZATION_BYTES = 8192;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;

function bearerToken(request: FastifyRequest): string {
  const values: string[] = [];
  const rawHeaders = request.raw.rawHeaders;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === "authorization") {
      const value = rawHeaders[index + 1];
      if (value === undefined) throw new InvalidAccessTokenError();
      values.push(value);
    }
  }
  const value = values.length === 1 ? values[0] : undefined;
  if (
    value === undefined
    || Buffer.byteLength(value, "utf8") > MAX_AUTHORIZATION_BYTES
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
 * Establishes the request principal from exactly one canonical Bearer JWT.
 * Header cardinality, byte/control checks, and syntax checks run before cryptographic verification;
 * the request remains unauthenticated on every failure.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /** @param verifier - The sole authority allowed to derive an authenticated principal. */
  public constructor(
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
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
    const principal: AuthPrincipal = await this.verifier.verify(token);
    request.principal = principal;
    return true;
  }
}
