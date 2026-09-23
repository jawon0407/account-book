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
  /**
   * 메모리 기반 테스트 제공자를 만듭니다. bridge가 지정되면 비밀번호 로그인에 한해 로컬 테스트 HTTP 서버를 사용합니다.
   * @param bridge 검증된 테스트 토큰 URL과 선택적 fetch 함수.
   */
  public constructor(private readonly bridge?: Readonly<{ tokenUrl: URL; fetcher?: typeof fetch }>) {}

  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 설정한 가입 응답을 반환하는 테스트용 동작입니다.
   * @param input 검증된 가입 이메일·비밀번호.
   * @param redirectUrl 신뢰된 메일 확인 콜백.
   * @param codeChallenge 서버 PKCE 비밀값의 S256 해시.
   * @returns 메일 인증 필요 여부 또는 인증된 서버 토큰 쌍.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
  public async signUp(input: SignUpInput, redirectUrl: URL, codeChallenge: string): Promise<EmailAuthResult> { this.calls.signUp.push([input, redirectUrl, codeChallenge]); return this.result(this.signUpResult); }
  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 기본은 설정된 토큰을 반환하고, bridge가 있으면 로컬 테스트 제공자에 5초 제한 POST를 보내 크기와 응답 구조를 검사합니다.
   * @param input 검증된 로그인 입력.
   * @returns 메일 인증된 사용자의 서버 전용 토큰 쌍.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
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
  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 설정한 이메일 확인 토큰을 반환합니다.
   * @param input 확인 코드와 대응하는 PKCE 검증값.
   * @returns 검증된 서버 전용 토큰 쌍.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
  public async confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair> { this.calls.confirmEmail.push(input); return this.required(this.confirmationResult); }
  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 설정한 OAuth URL을 반환합니다.
   * @param input 제공자·신뢰된 콜백 URL·S256 챌린지.
   * @returns 검증된 제공자 인증 URL.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
  public async startOAuth(input: OAuthStartInput): Promise<OAuthStartResult> { this.calls.startOAuth.push(input); return this.required(this.oauthStartResult); }
  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 설정한 OAuth 토큰을 반환합니다.
   * @param input OAuth 코드와 대응하는 PKCE 검증값.
   * @returns 검증된 서버 전용 토큰 쌍.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
  public async exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair> { this.calls.exchangeOAuthCode.push(input); return this.required(this.oauthExchangeResult); }
  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 설정한 갱신 토큰 쌍을 반환합니다.
   * @param refreshToken 복호화한 제공자 갱신 토큰.
   * @returns 새 접근·갱신 토큰 및 사용자·만료 정보.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
  public async refresh(refreshToken: string): Promise<AuthTokenPair> { this.calls.refresh.push(refreshToken); return this.required(this.refreshResult); }
  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 실제 외부 폐기 없이 설정된 실패만 재현합니다.
   * @param accessToken 복호화한 제공자 접근 토큰.
   * @param refreshToken 복호화한 제공자 갱신 토큰.
   * @returns 제공자 폐기가 완료되면 값 없이 종료합니다.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
  public async signOut(accessToken: string, refreshToken: string): Promise<void> { this.calls.signOut.push([accessToken, refreshToken]); this.throwFailure(); }
  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 실제 메일 발송 없이 설정된 실패만 재현합니다.
   * @param email 검증된 이메일.
   * @param redirectUrl 신뢰된 복구 콜백 URL.
   * @param codeChallenge PKCE S256 챌린지.
   * @returns 계정 존재 여부를 노출하지 않고 완료합니다.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
  public async requestPasswordReset(email: string, redirectUrl: URL, codeChallenge: string): Promise<void> { this.calls.requestPasswordReset.push([email, redirectUrl, codeChallenge]); this.throwFailure(); }
  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 설정한 복구 자격 증명을 반환합니다.
   * @param input 복구 코드와 PKCE 검증값.
   * @returns 서버 전용 복구 토큰과 공개 사용자 정보.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
  public async exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext> { this.calls.exchangeRecoveryCode.push(input); return this.required(this.recoveryResult); }
  /**
   * 호출 입력을 메모리의 calls에 기록합니다. 실제 비밀번호 변경 없이 설정된 실패만 재현합니다.
   * @param input 복구 접근·갱신 토큰, 사용자 ID, 검증된 새 비밀번호.
   * @returns 비밀번호 변경이 완료되면 값 없이 종료합니다.
   * @throws 설정된 failure 또는 필수 결과 누락 시 AuthProviderError.
   */
  public async updatePassword(input: PasswordUpdateAtProviderInput): Promise<void> { this.calls.updatePassword.push(input); this.throwFailure(); }

  /**
   * 설정된 실패를 먼저 재현하고 실패가 없을 때 미리 설정한 값을 반환합니다.
   * @param value 테스트가 지정한 결과.
   * @returns 전달받은 값 그대로.
   * @throws failure가 설정돼 있으면 그 오류.
   */
  private result<T>(value: T): T { this.throwFailure(); return value; }
  /**
   * 필수 테스트 응답이 null이면 실패시키고, 있으면 설정된 실패 여부를 검사합니다.
   * @param value 필수 결과 또는 null.
   * @returns null이 아닌 설정 결과.
   * @throws 결과가 없거나 failure가 지정되면 AuthProviderError.
   */
  private required<T>(value: T | null): T { return this.result(value ?? (() => { throw new AuthProviderError(); })()); }
  /**
   * 테스트에서 지정한 failure가 있을 때 그대로 던집니다.
   * @returns 실패 설정이 없으면 값 없이 종료합니다.
   * @throws 설정된 AuthProviderError.
   */
  private throwFailure(): void { if (this.failure !== null) throw this.failure; }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Strictly narrows the bounded test-IDP response without retaining rejected provider detail. */
/**
 * 테스트 제공자의 JSON 필드가 정확히 일치하는지와 사용자·UUID·토큰 크기·표준 ISO 만료 시각을 검사합니다.
 * @param value 크기 제한을 통과한 테스트 응답 JSON.
 * @returns 검증한 토큰 쌍; 만료 문자열은 Date로 바꿉니다.
 * @throws 잘못된 응답이면 세부값 없는 AuthProviderError.
 */
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
