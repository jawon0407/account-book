import { CurrentUserSchema, PasswordResetRequestInputSchema, SignInInputSchema, SignUpInputSchema, type CurrentUser } from "@account-book/contracts";
import type { SessionTokenPair } from "../session/session-service.js";
import { AuthProviderError, type AuthProviderErrorCode, type AuthProviderPort, type AuthTokenPair, type EmailConfirmationInput } from "./auth-provider-port.js";

/** Validated callback URLs and injected time for an email-auth operation. */
export type EmailAuthContext = Readonly<{ emailRedirectUrl: URL; passwordResetRedirectUrl: URL; now: Date }>;
type SessionCreator = Readonly<{ create(tokens: SessionTokenPair, now: Date): Promise<Readonly<{ selector: string; accessTokenExpiresAt: Date; absoluteExpiresAt: Date }>> }>;
type PublicSession = Readonly<{ selector: string; user: CurrentUser; accessTokenExpiresAt: Date; absoluteExpiresAt: Date }>;

/** Fixed use-case error that never includes submitted credentials, codes, emails, or provider text. */
export class EmailAuthServiceError extends Error {
  public constructor(public readonly code: AuthProviderErrorCode) { super(code); this.name = "EmailAuthServiceError"; }
}

function fail(code: AuthProviderErrorCode = "AUTH_PROVIDER_UNAVAILABLE"): never { throw new EmailAuthServiceError(code); }
function safeContext(context: EmailAuthContext): EmailAuthContext {
  const urls = [context?.emailRedirectUrl, context?.passwordResetRedirectUrl];
  if (!(context?.now instanceof Date) || !Number.isFinite(context.now.getTime()) || !urls.every((url) => url instanceof URL && url.username === "" && url.password === "" && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))))) return fail();
  return context;
}
function providerFailure(error: unknown): never {
  if (error instanceof EmailAuthServiceError) throw error;
  if (error instanceof AuthProviderError) return fail(error.code);
  return fail();
}
function verifiedPair(pair: AuthTokenPair): AuthTokenPair {
  const parsed = CurrentUserSchema.safeParse(pair?.user);
  if (!parsed.success || !parsed.data.emailVerified || parsed.data.id !== pair.userId) return fail("AUTH_EMAIL_VERIFICATION_REQUIRED");
  return pair;
}

/** Coordinates schema validation, provider calls, and opaque-session creation for email authentication. */
export class EmailAuthService {
  public constructor(private readonly provider: AuthProviderPort, private readonly sessions: SessionCreator) {}

  /** Requests signup delivery and always returns an account-enumeration-resistant acknowledgement. */
  public async signUp(input: unknown, context: EmailAuthContext): Promise<Readonly<{ accepted: true }>> {
    try {
      const parsed = SignUpInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      await this.provider.signUp(parsed.data, safeContext(context).emailRedirectUrl);
      return { accepted: true };
    } catch (error) { return providerFailure(error); }
  }

  /** Signs in a verified user and returns only opaque-session metadata. */
  public async signIn(input: unknown, context: EmailAuthContext): Promise<PublicSession> {
    try {
      const parsed = SignInInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      return await this.create(verifiedPair(await this.provider.signInWithPassword(parsed.data)), safeContext(context));
    } catch (error) { return providerFailure(error); }
  }

  /** Exchanges a server callback code only after validating its exact trusted context. */
  public async confirmEmail(input: EmailConfirmationInput, context: EmailAuthContext): Promise<PublicSession> {
    try { return await this.create(verifiedPair(await this.provider.confirmEmail(input)), safeContext(context)); } catch (error) { return providerFailure(error); }
  }

  /** Starts reset delivery without exposing whether the email belongs to an account. */
  public async requestPasswordReset(email: string, context: EmailAuthContext): Promise<Readonly<{ accepted: true }>> {
    try {
      const parsed = PasswordResetRequestInputSchema.safeParse({ email });
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      await this.provider.requestPasswordReset(parsed.data.email, safeContext(context).passwordResetRedirectUrl);
      return { accepted: true };
    } catch (error) { return providerFailure(error); }
  }

  private async create(pair: AuthTokenPair, context: EmailAuthContext): Promise<PublicSession> {
    const created = await this.sessions.create({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, userId: pair.userId, supabaseSessionId: pair.supabaseSessionId, accessTokenExpiresAt: pair.accessTokenExpiresAt }, context.now);
    return { selector: created.selector, user: pair.user, accessTokenExpiresAt: created.accessTokenExpiresAt, absoluteExpiresAt: created.absoluteExpiresAt };
  }
}
