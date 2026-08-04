import { CurrentUserSchema } from "@account-book/contracts";
import type { AuthProviderPort, AuthTokenPair, EmailAuthResult, EmailConfirmationInput, OAuthExchangeInput, OAuthStartInput, OAuthStartResult, PasswordUpdateAtProviderInput, RecoveryContext, RecoveryExchangeInput } from "./auth-provider-port.js";
import { AuthProviderError } from "./auth-provider-port.js";
import type { SignInInput, SignUpInput } from "@account-book/contracts";

/** Deterministic test-only provider fake; applications must construct an explicit real adapter instead. */
export class FakeAuthProvider implements AuthProviderPort {
  public signUpResult: EmailAuthResult = { status: "verification_required" };
  public signInResult: AuthTokenPair | null = null;
  public confirmationResult: AuthTokenPair | null = null;
  public oauthStartResult: OAuthStartResult | null = null;
  public oauthExchangeResult: AuthTokenPair | null = null;
  public refreshResult: AuthTokenPair | null = null;
  public recoveryResult: RecoveryContext | null = null;
  public failure: AuthProviderError | null = null;
  public readonly calls: { signUp: Array<[SignUpInput, URL, string]>; signInWithPassword: SignInInput[]; confirmEmail: EmailConfirmationInput[]; startOAuth: OAuthStartInput[]; exchangeOAuthCode: OAuthExchangeInput[]; refresh: string[]; signOut: Array<[string, string]>; requestPasswordReset: Array<[string, URL, string]>; exchangeRecoveryCode: RecoveryExchangeInput[]; updatePassword: PasswordUpdateAtProviderInput[] } = {
    signUp: [], signInWithPassword: [], confirmEmail: [], startOAuth: [], exchangeOAuthCode: [], refresh: [], signOut: [], requestPasswordReset: [], exchangeRecoveryCode: [], updatePassword: [],
  };

  /**
   * Creates a deterministic in-memory fake unless an already-validated loopback token bridge is explicit.
   * @param bridge - Test-only server URL and optional fetch seam; production container policy rejects this mode first.
   */
  public constructor(private readonly bridge?: Readonly<{ tokenUrl: URL; fetcher?: typeof fetch }>) {}

  public async signUp(input: SignUpInput, redirectUrl: URL, codeChallenge: string): Promise<EmailAuthResult> { this.calls.signUp.push([input, redirectUrl, codeChallenge]); return this.result(this.signUpResult); }
  public async signInWithPassword(input: SignInInput): Promise<AuthTokenPair> {
    this.calls.signInWithPassword.push(input);
    if (this.bridge === undefined) return this.required(this.signInResult);
    try {
      const response = await (this.bridge.fetcher ?? fetch)(this.bridge.tokenUrl, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 401) throw new AuthProviderError("AUTH_INVALID_CREDENTIALS");
      if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new AuthProviderError();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 65_536) throw new AuthProviderError();
      return bridgeTokenPair(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    } catch (error) {
      if (error instanceof AuthProviderError) throw error;
      throw new AuthProviderError();
    }
  }
  public async confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair> { this.calls.confirmEmail.push(input); return this.required(this.confirmationResult); }
  public async startOAuth(input: OAuthStartInput): Promise<OAuthStartResult> { this.calls.startOAuth.push(input); return this.required(this.oauthStartResult); }
  public async exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair> { this.calls.exchangeOAuthCode.push(input); return this.required(this.oauthExchangeResult); }
  public async refresh(refreshToken: string): Promise<AuthTokenPair> { this.calls.refresh.push(refreshToken); return this.required(this.refreshResult); }
  public async signOut(accessToken: string, refreshToken: string): Promise<void> { this.calls.signOut.push([accessToken, refreshToken]); this.throwFailure(); }
  public async requestPasswordReset(email: string, redirectUrl: URL, codeChallenge: string): Promise<void> { this.calls.requestPasswordReset.push([email, redirectUrl, codeChallenge]); this.throwFailure(); }
  public async exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext> { this.calls.exchangeRecoveryCode.push(input); return this.required(this.recoveryResult); }
  public async updatePassword(input: PasswordUpdateAtProviderInput): Promise<void> { this.calls.updatePassword.push(input); this.throwFailure(); }

  private result<T>(value: T): T { this.throwFailure(); return value; }
  private required<T>(value: T | null): T { return this.result(value ?? (() => { throw new AuthProviderError(); })()); }
  private throwFailure(): void { if (this.failure !== null) throw this.failure; }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Strictly narrows the bounded test-IDP response without retaining rejected provider detail. */
function bridgeTokenPair(value: unknown): AuthTokenPair {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AuthProviderError();
  const pair = value as Record<string, unknown>;
  const keys = ["accessToken", "accessTokenExpiresAt", "issuedAtSeconds", "refreshToken", "supabaseSessionId", "user", "userId"];
  if (Object.keys(pair).sort().join(",") !== keys.join(",")) throw new AuthProviderError();
  const user = CurrentUserSchema.safeParse(pair.user);
  const expiresAt = typeof pair.accessTokenExpiresAt === "string" ? new Date(pair.accessTokenExpiresAt) : new Date(Number.NaN);
  const now = Date.now();
  if (
    !user.success || user.data.id !== pair.userId || !user.data.emailVerified ||
    typeof pair.accessToken !== "string" || pair.accessToken.length === 0 || pair.accessToken.length > 16_384 ||
    typeof pair.refreshToken !== "string" || pair.refreshToken.length === 0 || pair.refreshToken.length > 4_096 ||
    typeof pair.userId !== "string" || !UUID_PATTERN.test(pair.userId) ||
    typeof pair.supabaseSessionId !== "string" || !UUID_PATTERN.test(pair.supabaseSessionId) ||
    typeof pair.issuedAtSeconds !== "number" || !Number.isSafeInteger(pair.issuedAtSeconds) || pair.issuedAtSeconds <= 0 || pair.issuedAtSeconds * 1_000 > now ||
    !Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== pair.accessTokenExpiresAt || expiresAt.getTime() <= now || expiresAt.getTime() <= pair.issuedAtSeconds * 1_000
  ) throw new AuthProviderError();
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    userId: pair.userId,
    supabaseSessionId: pair.supabaseSessionId,
    issuedAtSeconds: pair.issuedAtSeconds,
    accessTokenExpiresAt: expiresAt,
    user: user.data,
  };
}
