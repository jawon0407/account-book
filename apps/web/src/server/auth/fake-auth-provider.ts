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
  public readonly calls: { signUp: Array<[SignUpInput, URL]>; signInWithPassword: SignInInput[]; confirmEmail: EmailConfirmationInput[]; startOAuth: OAuthStartInput[]; exchangeOAuthCode: OAuthExchangeInput[]; refresh: string[]; signOut: Array<[string, string]>; requestPasswordReset: Array<[string, URL]>; exchangeRecoveryCode: RecoveryExchangeInput[]; updatePassword: PasswordUpdateAtProviderInput[] } = {
    signUp: [], signInWithPassword: [], confirmEmail: [], startOAuth: [], exchangeOAuthCode: [], refresh: [], signOut: [], requestPasswordReset: [], exchangeRecoveryCode: [], updatePassword: [],
  };

  public async signUp(input: SignUpInput, redirectUrl: URL): Promise<EmailAuthResult> { this.calls.signUp.push([input, redirectUrl]); return this.result(this.signUpResult); }
  public async signInWithPassword(input: SignInInput): Promise<AuthTokenPair> { this.calls.signInWithPassword.push(input); return this.required(this.signInResult); }
  public async confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair> { this.calls.confirmEmail.push(input); return this.required(this.confirmationResult); }
  public async startOAuth(input: OAuthStartInput): Promise<OAuthStartResult> { this.calls.startOAuth.push(input); return this.required(this.oauthStartResult); }
  public async exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair> { this.calls.exchangeOAuthCode.push(input); return this.required(this.oauthExchangeResult); }
  public async refresh(refreshToken: string): Promise<AuthTokenPair> { this.calls.refresh.push(refreshToken); return this.required(this.refreshResult); }
  public async signOut(accessToken: string, refreshToken: string): Promise<void> { this.calls.signOut.push([accessToken, refreshToken]); this.throwFailure(); }
  public async requestPasswordReset(email: string, redirectUrl: URL): Promise<void> { this.calls.requestPasswordReset.push([email, redirectUrl]); this.throwFailure(); }
  public async exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext> { this.calls.exchangeRecoveryCode.push(input); return this.required(this.recoveryResult); }
  public async updatePassword(input: PasswordUpdateAtProviderInput): Promise<void> { this.calls.updatePassword.push(input); this.throwFailure(); }

  private result<T>(value: T): T { this.throwFailure(); return value; }
  private required<T>(value: T | null): T { return this.result(value ?? (() => { throw new AuthProviderError(); })()); }
  private throwFailure(): void { if (this.failure !== null) throw this.failure; }
}
