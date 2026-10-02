import { randomUUID } from "node:crypto";
import { CurrentUserSchema, SignInInputSchema, SignUpInputSchema, type CurrentUser } from "@account-book/contracts";
import type { AuthRepository, EmailConfirmationTransactionRecord } from "../persistence/auth-repository.js";
import { createPkceVerifier, derivePkceChallenge } from "../security/pkce.js";
import { validProviderIssuedAt } from "../security/provider-time.js";
import { hashSessionSelector } from "../security/session-selector.js";
import { decryptToken, encryptToken, type TokenKeyring } from "../security/token-envelope.js";
import type { SessionTokenPair } from "../session/session-service.js";
import { AuthProviderError, type AuthProviderErrorCode, type AuthProviderPort, type AuthTokenPair } from "./auth-provider-port.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CONFIRMATION_LIFETIME_MS = 15 * 60_000;

/** Trusted callbacks, pre-auth interaction, and time for an email-auth operation. */
export type EmailAuthContext = Readonly<{ emailRedirectUrl: URL; interactionSelector: string; now: Date }>;
type SessionCreator = Readonly<{
  /**
   * 검증된 제공자 토큰을 앱 세션으로 저장하는 최소 경계입니다. 원문 토큰은 반환하지 않습니다.
   * @param tokens 서버가 보관할 제공자 접근·갱신 토큰과 소유자·만료 정보.
   * @param now 세션 생성 기준 시각.
   * @returns 브라우저용 불투명 식별자와 접근 토큰·앱 세션의 만료 시각.
   * @throws 세션 검증·암호화·저장 실패.
   */
  create(tokens: SessionTokenPair, now: Date): Promise<Readonly<{ selector: string; accessTokenExpiresAt: Date; absoluteExpiresAt: Date }>>
}>;
type PublicSession = Readonly<{ selector: string; user: CurrentUser; accessTokenExpiresAt: Date; absoluteExpiresAt: Date }>;

/** Fixed use-case error that never includes credentials, codes, emails, verifiers, or selectors. */
export class EmailAuthServiceError extends Error {
  /** Creates one allowlisted email-auth failure without retaining submitted values. */
  /**
   * 외부 입력을 담지 않고 허용된 코드만 보관하는 서비스 오류를 만듭니다.
   * @param code 호출자에게 전달할 고정 오류 코드.
   */
  public constructor(public readonly code: AuthProviderErrorCode) {
    super(code);
    this.name = "EmailAuthServiceError";
  }
}

/**
 * 허용된 코드로 이메일 인증 흐름을 중단하며 자격 증명은 오류에 담지 않습니다.
 * @param code 실패 분류; 생략 시 제공자 가용성 오류.
 * @returns 반환하지 않습니다.
 * @throws EmailAuthServiceError.
 */
function fail(code: AuthProviderErrorCode = "AUTH_PROVIDER_UNAVAILABLE"): never { throw new EmailAuthServiceError(code); }
/**
 * 값이 실제 Date이고 유한한 시각을 가리키는지 확인합니다.
 * @param value 검사할 값.
 * @returns 유효한 날짜이면 true.
 */
function validDate(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }
/**
 * 제공자 호출이 끝난 뒤 시계를 다시 읽어 응답 지연을 반영한 시각을 복사합니다.
 * @param clock 현재 Date를 반환하는 함수.
 * @returns 유효한 완료 시각의 복사본.
 * @throws 시계가 잘못된 값을 주면 가용성 오류.
 */
function postProviderTime(clock: () => Date): Date { const value = clock(); if (!validDate(value)) return fail(); return new Date(value); }
/**
 * 값이 소문자 16진수 UUID 형태인지 확인합니다.
 * @param value 검사할 식별자.
 * @returns 문자열 형식이 맞으면 true.
 */
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
/**
 * 콜백 코드가 비어 있지 않고 4096자 이하이며 앞뒤 공백·제어문자가 없는지 검사합니다.
 * @param value 외부 콜백 코드.
 * @returns 검증된 원래 문자열.
 * @throws 검증 실패 시 인증 트랜잭션 오류.
 */
function safeCode(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
  return value;
}
/**
 * 콜백 URL을 복사하고 인증정보·해시를 금지합니다. HTTPS 또는 로컬 호스트의 HTTP만 허용합니다.
 * @param value 서버 설정에서 받은 URL.
 * @returns 검증된 URL 복사본.
 * @throws 잘못된 URL이면 서비스 가용성 오류.
 */
function safeUrl(value: unknown): URL {
  if (!(value instanceof URL)) return fail();
  const url = new URL(value.toString());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || url.hash !== "" || !(url.protocol === "https:" || (local && url.protocol === "http:"))) return fail();
  return url;
}
/**
 * 시각·콜백 URL을 확인하고 브라우저 식별자를 해시로 바꾸어 저장소 조회에 쓸 컨텍스트를 만듭니다.
 * @param context 서버 콜백·브라우저 식별자·기준 시각.
 * @returns 검증된 컨텍스트와 식별자 해시.
 * @throws 잘못된 설정은 가용성 오류, 식별자는 트랜잭션 오류.
 */
function safeContext(context: EmailAuthContext): Readonly<EmailAuthContext & { interactionHash: Uint8Array }> {
  if (!validDate(context?.now)) return fail();
  let interactionHash: Uint8Array;
  try { interactionHash = hashSessionSelector(context?.interactionSelector); } catch { return fail("AUTH_OAUTH_TRANSACTION_INVALID"); }
  return { emailRedirectUrl: safeUrl(context?.emailRedirectUrl), interactionSelector: context.interactionSelector, interactionHash, now: context.now };
}
/**
 * 알려진 서비스 오류는 유지하고 제공자 오류는 허용 코드로 옮기며 나머지는 가용성 오류로 숨깁니다.
 * @param error 하위 계층에서 발생한 오류.
 * @returns 반환하지 않습니다.
 * @throws 해당 인증 서비스의 고정 코드 오류.
 */
function providerFailure(error: unknown): never {
  if (error instanceof EmailAuthServiceError) throw error;
  if (error instanceof AuthProviderError) return fail(error.code);
  return fail();
}
/**
 * 메일 인증된 사용자와 토큰 소유자 일치 여부, UUID 형식과 발급·만료 시각을 확인합니다.
 * @param pair 제공자가 반환한 토큰 쌍.
 * @param now 제공자 호출 완료 후 기준 시각.
 * @returns 검증된 원래 토큰 쌍.
 * @throws 메일 미인증 또는 토큰 데이터 오류.
 */
function verifiedPair(pair: AuthTokenPair, now: Date): AuthTokenPair {
  const parsed = CurrentUserSchema.safeParse(pair?.user);
  if (!parsed.success || !parsed.data.emailVerified || parsed.data.id !== pair?.userId) return fail("AUTH_EMAIL_VERIFICATION_REQUIRED");
  if (!validUuid(pair?.userId) || !validUuid(pair?.supabaseSessionId) || typeof pair?.accessToken !== "string" || pair.accessToken.length === 0 || typeof pair?.refreshToken !== "string" || pair.refreshToken.length === 0 || !validProviderIssuedAt(pair?.issuedAtSeconds, now.getTime()) || !validDate(pair?.accessTokenExpiresAt) || pair.accessTokenExpiresAt.getTime() <= now.getTime() || pair.accessTokenExpiresAt.getTime() <= pair.issuedAtSeconds * 1000) return fail();
  return pair;
}
/**
 * 이메일 인증의 15분 유효기간을 기준 시각에 더합니다.
 * @param now 인증 시작 시각.
 * @returns 만료 시각 Date.
 * @throws 계산 결과가 유효하지 않으면 가용성 오류.
 */
function shifted(now: Date): Date {
  const expiresAt = new Date(now.getTime() + CONFIRMATION_LIFETIME_MS);
  if (!validDate(expiresAt)) return fail();
  return expiresAt;
}
/**
 * 원자적으로 사용 처리된 이메일 인증 레코드가 현재 브라우저와 일치하고 아직 15분 기한 내인지 재검증합니다.
 * @param record 사용 처리 후 반환된 레코드.
 * @param interactionHash 현재 식별자 해시.
 * @param now 확인 기준 시각.
 * @returns 검증된 레코드.
 * @throws 불일치·만료·잘못된 상태이면 트랜잭션 오류.
 */
function claimed(record: EmailConfirmationTransactionRecord, interactionHash: Uint8Array, now: Date): EmailConfirmationTransactionRecord {
  if (
    !validUuid(record?.id) || !(record?.interactionHash instanceof Uint8Array) || record.interactionHash.length !== 32 || !Buffer.from(record.interactionHash).equals(Buffer.from(interactionHash)) ||
    !validDate(record?.createdAt) || !validDate(record?.expiresAt) || !validDate(record?.consumedAt) || record.expiresAt.getTime() <= now.getTime() ||
    record.expiresAt.getTime() - record.createdAt.getTime() !== CONFIRMATION_LIFETIME_MS
  ) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
  return record;
}

/** Coordinates email signup PKCE continuity, verified sign-in, and opaque-session creation. */
export class EmailAuthService {
  /** Installs narrow provider/session/transaction ports and injectable cryptographic generators. */
  /**
   * 제공자·세션·저장소와 암호화 도구를 연결합니다. 생성 시에는 외부 요청을 보내지 않습니다.
   * @param provider 회원가입·로그인·메일 확인 기능.
   * @param sessions 앱 세션 생성 기능.
   * @param repository 이메일 인증 트랜잭션 저장·사용 처리 기능.
   * @param keyring PKCE 검증값 암호화 키.
   * @param createId 트랜잭션 UUID 생성 함수.
   * @param createVerifier PKCE 비밀 검증값 생성 함수.
   * @param clock 제공자 응답 이후 현재 시각을 얻는 함수.
   */
  public constructor(
    private readonly provider: Pick<AuthProviderPort, "signUp" | "signInWithPassword" | "confirmEmail">,
    private readonly sessions: SessionCreator,
    private readonly repository: Pick<AuthRepository, "createEmailConfirmationTransaction" | "claimEmailConfirmationTransaction">,
    private readonly keyring: TokenKeyring,
    private readonly createId: () => string = randomUUID,
    private readonly createVerifier: () => string = createPkceVerifier,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Stores a fifteen-minute encrypted verifier before signup delivery.
   * @param input - Untrusted signup credentials validated at this boundary.
   * @param context - Trusted callback, interaction, and time.
   * @returns The account-enumeration-resistant acknowledgement.
   * @throws A fixed auth code for invalid input or unavailable dependencies.
   */
  /**
   * 입력을 검증하고 PKCE 비밀값을 암호화해 15분 트랜잭션으로 저장한 뒤 가입 메일을 요청합니다. 계정 존재 여부를 숨기기 위해 일부 제공자 오류도 접수 성공으로 처리합니다.
   * @param input 검사 전 이메일·비밀번호.
   * @param context 신뢰된 콜백·브라우저 식별자·시각.
   * @returns 계정 존재 여부와 무관한 accepted: true 표시.
   * @throws 입력 오류 또는 저장소·제공자 실패의 고정 코드.
   */
  public async signUp(input: unknown, context: EmailAuthContext): Promise<Readonly<{ accepted: true }>> {
    try {
      const parsed = SignUpInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      const trusted = safeContext(context);
      const id = this.createId();
      if (!validUuid(id)) return fail();
      const verifier = this.createVerifier();
      const challenge = derivePkceChallenge(verifier);
      await this.repository.createEmailConfirmationTransaction({
        id,
        interactionHash: trusted.interactionHash,
        encryptedPkceVerifier: encryptToken(verifier, { recordId: id, tokenKind: "pkce" }, this.keyring),
        createdAt: new Date(trusted.now),
        expiresAt: shifted(trusted.now),
        consumedAt: null,
      });
      await this.provider.signUp(parsed.data, trusted.emailRedirectUrl, challenge);
      return { accepted: true };
    } catch (error) {
      if (error instanceof AuthProviderError && (error.code === "AUTH_INVALID_CREDENTIALS" || error.code === "AUTH_EMAIL_VERIFICATION_REQUIRED")) return { accepted: true };
      return providerFailure(error);
    }
  }

  /**
   * Signs in one verified email user.
   * @param input - Untrusted email/password credentials.
   * @param context - Trusted interaction and time context.
   * @returns Only opaque-session metadata and the public user.
   * @throws A fixed auth code for invalid, unverified, or failed sign-in.
   */
  /**
   * 이메일·비밀번호로 제공자 로그인을 수행하고 응답 시각에 토큰을 검사한 뒤 앱 세션을 저장합니다.
   * @param input 검사 전 로그인 자격 증명.
   * @param context 신뢰된 로그인 전 컨텍스트.
   * @returns 브라우저용 식별자·공개 사용자·만료 시각; 제공자 토큰은 제외합니다.
   * @throws 입력·메일 인증·제공자·세션 생성 실패의 고정 코드.
   */
  public async signIn(input: unknown, context: EmailAuthContext): Promise<PublicSession> {
    try {
      const parsed = SignInInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      safeContext(context);
      const providerPair = await this.provider.signInWithPassword(parsed.data);
      const completedAt = postProviderTime(this.clock);
      return await this.create(verifiedPair(providerPair, completedAt), completedAt);
    } catch (error) { return providerFailure(error); }
  }

  /**
   * Claims the live email transaction before code exchange.
   * @param input - The server callback code.
   * @param context - Trusted interaction and callback time.
   * @returns Only opaque-session metadata and the verified public user.
   * @throws A fixed auth code for malformed, expired, replayed, or failed confirmation.
   */
  /**
   * 현재 브라우저의 트랜잭션을 먼저 사용 처리하고 PKCE 비밀값을 복호화해 코드를 교환합니다. 이후 앱 세션을 저장합니다.
   * @param input 메일 콜백의 code.
   * @param context 현재 브라우저 식별자·콜백·시각.
   * @returns 식별자·공개 사용자·세션 만료 정보.
   * @throws 재사용·만료·잘못된 코드 또는 하위 의존성 오류.
   */
  public async confirmEmail(input: Readonly<{ code: string }>, context: EmailAuthContext): Promise<PublicSession> {
    try {
      const code = safeCode(input?.code);
      const trusted = safeContext(context);
      const transaction = await this.repository.claimEmailConfirmationTransaction(trusted.interactionHash, new Date(trusted.now));
      if (transaction === null) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
      const record = claimed(transaction, trusted.interactionHash, trusted.now);
      const codeVerifier = decryptToken(record.encryptedPkceVerifier, { recordId: record.id, tokenKind: "pkce" }, this.keyring);
      derivePkceChallenge(codeVerifier);
      const providerPair = await this.provider.confirmEmail({ code, codeVerifier });
      const completedAt = postProviderTime(this.clock);
      return await this.create(verifiedPair(providerPair, completedAt), completedAt);
    } catch (error) {
      if (error instanceof EmailAuthServiceError || error instanceof AuthProviderError) return providerFailure(error);
      return fail("AUTH_OAUTH_TRANSACTION_INVALID");
    }
  }

  /**
   * 검증된 제공자 토큰을 세션 저장 기능에 넘기고 브라우저에 필요한 공개 정보만 조합합니다.
   * @param pair 검증된 제공자 토큰과 사용자.
   * @param now 세션 생성 기준 시각.
   * @returns 불투명 식별자·사용자·만료 정보.
   * @throws 세션 저장 오류가 호출자에게 전달됩니다.
   */
  private async create(pair: AuthTokenPair, now: Date): Promise<PublicSession> {
    const created = await this.sessions.create({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, userId: pair.userId, supabaseSessionId: pair.supabaseSessionId, issuedAtSeconds: pair.issuedAtSeconds, accessTokenExpiresAt: pair.accessTokenExpiresAt }, now);
    return { selector: created.selector, user: pair.user, accessTokenExpiresAt: created.accessTokenExpiresAt, absoluteExpiresAt: created.absoluteExpiresAt };
  }
}
