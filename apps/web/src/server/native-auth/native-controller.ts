import "server-only";
import { NativeAuthResponseSchema, NativeSessionSchema, NativeSignInInputSchema, type NativeSession } from "@account-book/contracts";
import { AuthProviderError, type AuthProviderPort } from "../auth/auth-provider-port.js";
import { EmailAuthServiceError, verifiedPair } from "../auth/email-auth-service.js";
import { CoreBoundaryError, coreFailure, coreJson } from "../core/http-boundary.js";
import { SessionOperationError, type SessionService } from "../session/session-service.js";
import { nativeBody, nativeBoundary } from "./native-boundary.js";
import type { NativeOperation, NativeRateLimitPort, NativeRateScope } from "./native-types.js";
export type { NativeOperation } from "./native-types.js";

export type NativeAuthDependencies = Readonly<{
  origin: URL; now(): Date;
  provider: Pick<AuthProviderPort, "signInWithPassword" | "signOut">;
  sessions: Pick<SessionService, "create" | "resolve" | "refresh" | "revokeCurrent" | "markRevocationPending">;
  limiter: NativeRateLimitPort;
}>;

/** @param value 서버 전용 세션의 공개 가능한 일부. 명시한 필드만 새 객체로 복사한다. */
function metadata(value: { userId: string; deviceId: string | null; accessTokenExpiresAt: Date }): NativeSession {
  return NativeSessionSchema.parse({ authenticated: true, userId: value.userId, deviceId: value.deviceId, refreshAt: new Date(value.accessTokenExpiresAt.getTime() - 60_000).toISOString() });
}

/** Android HTTP 흐름. 쿠키/제공자 토큰은 반환하지 않으며 실패 응답은 재전송을 권하지 않는다. */
export class NativeAuthController {
  /** @param deps 요청 전용 서비스. sessions는 서버 구성에서 Android 채널로 고정한다. */
  public constructor(private readonly deps: NativeAuthDependencies) {}

  /** @param operation 라우트의 고정 작업. @param request 외부 HTTP 요청. @returns 캐시 금지 응답. */
  public async handle(operation: NativeOperation, request: Request): Promise<Response> {
    try {
      const selector = nativeBoundary(operation, request, this.deps.origin);
      await this.limit(operation, "global", "all");
      if (operation === "signIn") return await this.signIn(request);
      if (operation !== "session") {
        const body = await nativeBody(request);
        if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) throw new CoreBoundaryError("AUTH_INVALID_CREDENTIALS", 400);
      }
      const session = await this.deps.sessions.resolve(selector!, this.now());
      if (session.clientChannel !== "android" || session.deviceId === null) throw new SessionOperationError("expired");
      await this.limit(operation, "identity", `${session.userId}:${session.deviceId}`);
      if (operation === "session") return coreJson(metadata(session));
      if (operation === "refresh") {
        const result = await this.deps.sessions.refresh(selector!, this.now());
        if (result.status !== "refreshed" || !("selector" in result)) throw new SessionOperationError("expired");
        const replacement = await this.deps.sessions.resolve(result.selector, this.now());
        if (replacement.clientChannel !== "android" || replacement.userId !== session.userId || replacement.deviceId !== session.deviceId) throw new SessionOperationError("expired");
        return coreJson(NativeAuthResponseSchema.parse({ sessionToken: result.selector, session: metadata(replacement) }));
      }
      if (!await this.deps.sessions.revokeCurrent(selector!, this.now())) throw new SessionOperationError("expired");
      try { await this.deps.provider.signOut(session.accessToken, session.refreshToken); }
      catch { await this.deps.sessions.markRevocationPending(session.sessionId, this.now()); }
      return coreJson({ signedOut: true });
    } catch (error) {
      if (error instanceof CoreBoundaryError) return coreFailure(error.code, error.status);
      if (error instanceof SessionOperationError) {
        if (error.reason === "expired") return coreFailure("AUTH_SESSION_EXPIRED", 401);
        if (error.reason === "rate_limited") return coreFailure("AUTH_RATE_LIMITED", 429);
      }
      if (error instanceof AuthProviderError || error instanceof EmailAuthServiceError) {
        if (error.code === "AUTH_INVALID_CREDENTIALS") return coreFailure(error.code, 401);
        if (error.code === "AUTH_EMAIL_VERIFICATION_REQUIRED") return coreFailure(error.code, 403);
        if (error.code === "AUTH_RATE_LIMITED") return coreFailure(error.code, 429);
      }
      return coreFailure("AUTH_PROVIDER_UNAVAILABLE", 503);
    }
  }

  /** @param request strict 이메일/비밀번호/설치 ID 입력. 제공자 호출 후 새 시각으로 검증한다. */
  private async signIn(request: Request): Promise<Response> {
    const input = NativeSignInInputSchema.safeParse(await nativeBody(request));
    if (!input.success) throw new CoreBoundaryError("AUTH_INVALID_CREDENTIALS", 400);
    const { email, password, deviceId } = input.data;
    await this.limit("signIn", "email", email.toLowerCase());
    await this.limit("signIn", "device", deviceId);
    const pair = await this.deps.provider.signInWithPassword({ email, password });
    const now = this.now();
    const created = await this.deps.sessions.create(verifiedPair(pair, now), now, deviceId);
    return coreJson(NativeAuthResponseSchema.parse({ sessionToken: created.selector, session: metadata({ ...created, deviceId }) }));
  }

  /** @param operation 고정 작업. @param scope 제한 단위. @param value 저장 전 HMAC할 구분값. */
  private async limit(operation: NativeOperation, scope: NativeRateScope, value: string): Promise<void> {
    if (!await this.deps.limiter.consume(operation, scope, value)) throw new CoreBoundaryError("AUTH_RATE_LIMITED", 429);
  }

  /** 호출 시점 시계를 복사해 비동기 제공자 지연을 반영한다. 잘못된 시계는 503으로 종료한다. */
  private now(): Date {
    const value = this.deps.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new SessionOperationError("unavailable");
    return new Date(value);
  }
}
