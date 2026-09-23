import { randomUUID } from "node:crypto";
import { CurrentUserSchema, PasswordResetRequestInputSchema, PasswordUpdateInputSchema } from "@account-book/contracts";
import type { AuthRepository, RecoveryTransactionRecord } from "../persistence/auth-repository.js";
import { createPkceVerifier, derivePkceChallenge } from "../security/pkce.js";
import { hashSessionSelector } from "../security/session-selector.js";
import { decryptToken, encryptToken, type TokenKeyring } from "../security/token-envelope.js";
import { AuthProviderError, type AuthProviderErrorCode, type AuthProviderPort, type RecoveryContext } from "./auth-provider-port.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const RECOVERY_LIFETIME_MS = 15 * 60_000;

/** Trusted callback, pre-auth interaction, and time for one recovery operation. */
export type PasswordRecoveryContext = Readonly<{ passwordResetRedirectUrl: URL; interactionSelector: string; now: Date }>;
type RecoveryRepository = Pick<AuthRepository, "createRecoveryTransaction" | "claimRecoveryExchange" | "promoteRecoveryExchange" | "claimRecoveryPasswordUpdate" | "consumeRecoveryAndRevokeSessions">;
type RecoveryProvider = Pick<AuthProviderPort, "requestPasswordReset" | "exchangeRecoveryCode" | "updatePassword">;
type CredentialPair = Readonly<{ accessToken: string; refreshToken: string }>;

/** Fixed recovery use-case error that never includes email, code, verifier, credential, or selector values. */
export class PasswordRecoveryServiceError extends Error {
  /** Creates one allowlisted recovery failure without retaining submitted values. */
  /**
   * 외부 입력을 담지 않고 허용된 코드만 보관하는 서비스 오류를 만듭니다.
   * @param code 호출자에게 전달할 고정 오류 코드.
   */
  public constructor(public readonly code: AuthProviderErrorCode = "AUTH_OAUTH_TRANSACTION_INVALID") {
    super(code);
    this.name = "PasswordRecoveryServiceError";
  }
}

/**
 * 복구 요청의 민감한 값을 숨기고 고정 코드 오류로 중단합니다.
 * @param code 실패 분류; 기본은 잘못된 인증 트랜잭션.
 * @returns 반환하지 않습니다.
 * @throws PasswordRecoveryServiceError.
 */
function fail(code: AuthProviderErrorCode = "AUTH_OAUTH_TRANSACTION_INVALID"): never { throw new PasswordRecoveryServiceError(code); }
/**
 * 값이 실제 Date이고 유한한 시각을 가리키는지 확인합니다.
 * @param value 검사할 값.
 * @returns 유효한 날짜이면 true.
 */
function validDate(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }
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
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail();
  return value;
}
/**
 * 복구 자격 증명이 비어 있지 않고 16384자 이하이며 앞뒤 공백·제어문자가 없는지 검사합니다.
 * @param value 제공자 토큰 후보.
 * @returns 검증된 문자열.
 * @throws 검증 실패 시 복구 트랜잭션 오류.
 */
function safeToken(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail();
  return value;
}
/**
 * 콜백 URL을 복사하고 인증정보·해시를 금지합니다. HTTPS 또는 로컬 호스트의 HTTP만 허용합니다.
 * @param value 서버 설정에서 받은 URL.
 * @returns 검증된 URL 복사본.
 * @throws 잘못된 URL이면 서비스 가용성 오류.
 */
function safeUrl(value: unknown): URL {
  if (!(value instanceof URL)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  const url = new URL(value.toString());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || url.hash !== "" || !(url.protocol === "https:" || (local && url.protocol === "http:"))) return fail("AUTH_PROVIDER_UNAVAILABLE");
  return url;
}
/**
 * 신뢰된 시각·복구 콜백을 검사하고 브라우저 식별자를 해시로 바꿉니다.
 * @param value 복구 요청 컨텍스트.
 * @returns 검증된 컨텍스트와 브라우저 식별자 해시.
 * @throws 잘못된 설정 또는 식별자이면 고정 서비스 오류.
 */
function context(value: PasswordRecoveryContext): Readonly<PasswordRecoveryContext & { interactionHash: Uint8Array }> {
  if (!validDate(value?.now)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  let interactionHash: Uint8Array;
  try { interactionHash = hashSessionSelector(value?.interactionSelector); } catch { return fail(); }
  return { passwordResetRedirectUrl: safeUrl(value?.passwordResetRedirectUrl), interactionSelector: value.interactionSelector, interactionHash, now: value.now };
}
/**
 * 복구 시작 시각에 15분을 더해 만료 시각을 만듭니다.
 * @param now 시작 기준 시각.
 * @returns 새 만료 Date.
 * @throws 유효하지 않은 계산 결과이면 가용성 오류.
 */
function shifted(now: Date): Date {
  const expiresAt = new Date(now.getTime() + RECOVERY_LIFETIME_MS);
  if (!validDate(expiresAt)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  return expiresAt;
}
/**
 * 복구 레코드 ID·브라우저 해시·15분 수명과 현재 만료 여부를 공통 검증합니다.
 * @param record 저장소가 반환한 복구 레코드.
 * @param interactionHash 현재 브라우저 식별자의 32바이트 해시.
 * @param now 만료 판단 기준 시각.
 * @returns 검증된 원래 레코드.
 * @throws 불일치나 만료 시 복구 오류.
 */
function commonRecord(record: RecoveryTransactionRecord, interactionHash: Uint8Array, now: Date): RecoveryTransactionRecord {
  if (
    !validUuid(record?.id) || !(record?.interactionHash instanceof Uint8Array) || record.interactionHash.length !== 32 || !Buffer.from(record.interactionHash).equals(Buffer.from(interactionHash)) ||
    !validDate(record?.createdAt) || !validDate(record?.expiresAt) || record.expiresAt.getTime() <= now.getTime() || record.expiresAt.getTime() - record.createdAt.getTime() !== RECOVERY_LIFETIME_MS
  ) return fail();
  return record;
}
/**
 * 공통 검증 후 코드 교환을 선점했지만 아직 사용자·자격 증명이 없는 대기 단계인지 검사합니다.
 * @param record 저장소가 반환한 복구 레코드.
 * @param interactionHash 현재 브라우저 식별자의 32바이트 해시.
 * @param now 만료 판단 기준 시각.
 * @returns 코드 교환을 진행할 수 있는 레코드.
 * @throws 단계나 저장 데이터가 잘못되면 복구 오류.
 */
function claimedExchange(record: RecoveryTransactionRecord, interactionHash: Uint8Array, now: Date): RecoveryTransactionRecord {
  const row = commonRecord(record, interactionHash, now);
  if (row.encryptedPkceVerifier === null || row.userId !== null || row.encryptedRecoveryToken !== null || !validDate(row.exchangeClaimedAt) || row.exchangedAt !== null || row.passwordUpdateClaimedAt !== null || row.consumedAt !== null) return fail();
  return row;
}
/**
 * 공통 검증 후 코드 교환 완료·비밀번호 갱신 선점·미소비 상태와 단계별 시각 순서를 확인합니다.
 * @param record 저장소가 반환한 복구 레코드.
 * @param interactionHash 현재 브라우저 식별자의 32바이트 해시.
 * @param now 만료 판단 기준 시각.
 * @returns 비밀번호 갱신에 사용할 레코드.
 * @throws 단계·시각·저장 데이터가 잘못되면 복구 오류.
 */
function claimedUpdate(record: RecoveryTransactionRecord, interactionHash: Uint8Array, now: Date): RecoveryTransactionRecord {
  const row = commonRecord(record, interactionHash, now);
  if (row.encryptedPkceVerifier !== null || !validUuid(row.userId) || row.encryptedRecoveryToken === null || !validDate(row.exchangeClaimedAt) || !validDate(row.exchangedAt) || !validDate(row.passwordUpdateClaimedAt) || row.consumedAt !== null || row.exchangeClaimedAt.getTime() > row.exchangedAt.getTime() || row.exchangedAt.getTime() > row.passwordUpdateClaimedAt.getTime()) return fail();
  return row;
}
/**
 * 메일 인증된 사용자 ID를 검증하고 복구용 접근·갱신 토큰을 추립니다.
 * @param value 제공자의 복구 코드 교환 응답.
 * @returns 사용자 ID와 서버 전용 자격 증명 쌍.
 * @throws 사용자나 토큰이 잘못되면 고정 복구 오류.
 */
function recoveryCredentials(value: RecoveryContext): Readonly<{ userId: string; credentials: CredentialPair }> {
  const user = CurrentUserSchema.safeParse(value?.user);
  if (!user.success || !user.data.emailVerified || !validUuid(user.data.id)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  return { userId: user.data.id, credentials: { accessToken: safeToken(value?.accessToken), refreshToken: safeToken(value?.refreshToken) } };
}
/**
 * 복호화한 JSON에 접근·갱신 토큰 두 필드만 정해진 순서와 표기로 담겼는지 확인합니다.
 * @param value 복호화한 JSON 문자열.
 * @returns 검증된 토큰 쌍.
 * @throws JSON 형식·필드·토큰 검증 실패 시 복구 오류.
 */
function canonicalCredentials(value: string): CredentialPair {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return fail();
    const object = parsed as Record<string, unknown>;
    const keys = Object.keys(object);
    if (keys.length !== 2 || keys[0] !== "accessToken" || keys[1] !== "refreshToken") return fail();
    const credentials = { accessToken: safeToken(object.accessToken), refreshToken: safeToken(object.refreshToken) };
    if (JSON.stringify(credentials) !== value) return fail();
    return credentials;
  } catch { return fail(); }
}
/**
 * 알려진 서비스 오류는 유지하고 제공자 오류는 허용 코드로 옮기며 나머지는 가용성 오류로 숨깁니다.
 * @param error 하위 계층에서 발생한 오류.
 * @returns 반환하지 않습니다.
 * @throws 해당 인증 서비스의 고정 코드 오류.
 */
function providerFailure(error: unknown): never {
  if (error instanceof PasswordRecoveryServiceError) throw error;
  if (error instanceof AuthProviderError) return fail(error.code);
  return fail("AUTH_PROVIDER_UNAVAILABLE");
}

/** Owns recovery PKCE creation, one-shot exchange promotion, and one-shot password update consumption. */
export class PasswordRecoveryService {
  /** Installs narrow transaction/provider ports and injectable cryptographic generators. */
  /**
   * 복구 트랜잭션 저장소·제공자·암호화 키와 테스트 가능한 난수 함수를 연결합니다.
   * @param repository 복구 단계 변경 및 세션 폐기 기능.
   * @param provider 복구 메일·코드 교환·비밀번호 변경 기능.
   * @param keyring 복구 비밀값 암호화 키.
   * @param createId 트랜잭션 UUID 생성 함수.
   * @param createVerifier PKCE 비밀 검증값 생성 함수.
   */
  public constructor(
    private readonly repository: RecoveryRepository,
    private readonly provider: RecoveryProvider,
    private readonly keyring: TokenKeyring,
    private readonly createId: () => string = randomUUID,
    private readonly createVerifier: () => string = createPkceVerifier,
  ) {}

  /**
   * Stores a fifteen-minute pending verifier before reset delivery.
   * @param email - The untrusted recovery email.
   * @param recoveryContext - Trusted callback, interaction, and time.
   * @returns The account-enumeration-resistant acknowledgement.
   * @throws A fixed auth code for invalid input or unavailable dependencies.
   */
  /**
   * PKCE 비밀값을 암호화한 15분 대기 레코드를 저장한 뒤 복구 메일을 요청합니다. 일부 계정 부재 오류도 접수 성공으로 처리합니다.
   * @param email 검사 전 복구 이메일.
   * @param recoveryContext 신뢰된 콜백·브라우저·시각.
   * @returns 계정 존재 여부를 드러내지 않는 accepted: true.
   * @throws 입력·저장소·제공자 실패의 고정 코드.
   */
  public async start(email: unknown, recoveryContext: PasswordRecoveryContext): Promise<Readonly<{ accepted: true }>> {
    try {
      const parsed = PasswordResetRequestInputSchema.safeParse({ email });
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      const trusted = context(recoveryContext);
      const id = this.createId();
      if (!validUuid(id)) return fail("AUTH_PROVIDER_UNAVAILABLE");
      const verifier = this.createVerifier();
      const challenge = derivePkceChallenge(verifier);
      await this.repository.createRecoveryTransaction({
        id,
        interactionHash: trusted.interactionHash,
        encryptedPkceVerifier: encryptToken(verifier, { recordId: id, tokenKind: "pkce" }, this.keyring),
        userId: null,
        encryptedRecoveryToken: null,
        createdAt: new Date(trusted.now),
        expiresAt: shifted(trusted.now),
        exchangeClaimedAt: null,
        exchangedAt: null,
        passwordUpdateClaimedAt: null,
        consumedAt: null,
      });
      await this.provider.requestPasswordReset(parsed.data.email, trusted.passwordResetRedirectUrl, challenge);
      return { accepted: true };
    } catch (error) {
      if (error instanceof AuthProviderError && error.code === "AUTH_INVALID_CREDENTIALS") return { accepted: true };
      return providerFailure(error);
    }
  }

  /**
   * Claims a pending row before exchanging the recovery code.
   * @param input - The server callback code.
   * @param recoveryContext - Trusted callback interaction and time.
   * @returns A public readiness marker without provider credentials.
   * @throws A fixed auth code for malformed, expired, replayed, or failed exchange.
   */
  /**
   * 대기 레코드를 먼저 선점하고 PKCE로 코드를 교환한 후, 검증값을 지우고 암호화한 복구 토큰으로 저장 상태를 바꿉니다.
   * @param input 복구 콜백 코드.
   * @param recoveryContext 신뢰된 브라우저·콜백·시각.
   * @returns 비밀번호 변경 준비를 알리는 ready: true.
   * @throws 재사용·만료·암호화·제공자·상태 경합 오류.
   */
  public async exchange(input: Readonly<{ code: string }>, recoveryContext: PasswordRecoveryContext): Promise<Readonly<{ ready: true }>> {
    try {
      const code = safeCode(input?.code);
      const trusted = context(recoveryContext);
      const transaction = await this.repository.claimRecoveryExchange(trusted.interactionHash, new Date(trusted.now));
      if (transaction === null) return fail();
      const record = claimedExchange(transaction, trusted.interactionHash, trusted.now);
      const codeVerifier = decryptToken(record.encryptedPkceVerifier, { recordId: record.id, tokenKind: "pkce" }, this.keyring);
      derivePkceChallenge(codeVerifier);
      const recovered = recoveryCredentials(await this.provider.exchangeRecoveryCode({ code, codeVerifier }));
      const encryptedRecoveryToken = encryptToken(JSON.stringify(recovered.credentials), { recordId: record.id, tokenKind: "recovery" }, this.keyring);
      const promoted = await this.repository.promoteRecoveryExchange({ transactionId: record.id, expectedExchangeClaimedAt: new Date(record.exchangeClaimedAt!), userId: recovered.userId, encryptedRecoveryToken, now: new Date(trusted.now) });
      if (!promoted) return fail();
      return { ready: true };
    } catch (error) {
      if (error instanceof PasswordRecoveryServiceError || error instanceof AuthProviderError) return providerFailure(error);
      return fail();
    }
  }

  /**
   * Claims one exchanged row and updates the matching provider user.
   * @param input - The new password validated at this boundary.
   * @param recoveryContext - Trusted interaction and time.
   * @returns A public success marker after atomic consumption and local revocation.
   * @throws A fixed auth code for invalid, replayed, mismatched, malformed, or failed updates.
   */
  /**
   * 복구 레코드의 비밀번호 변경을 선점하고 해당 사용자의 비밀번호를 변경합니다. 성공 후 레코드 소비와 모든 로컬 세션 폐기를 함께 저장합니다.
   * @param input 검사할 새 비밀번호.
   * @param recoveryContext 현재 브라우저와 신뢰된 시각·콜백.
   * @returns 소비 및 세션 폐기까지 성공하면 updated: true.
   * @throws 검증·재사용·만료·제공자·저장소 오류. 제공자 변경 후 저장 실패도 오류로 처리됩니다.
   */
  public async update(input: Readonly<{ password: string }>, recoveryContext: PasswordRecoveryContext): Promise<Readonly<{ updated: true }>> {
    try {
      const password = PasswordUpdateInputSchema.safeParse(input);
      if (!password.success) return fail("AUTH_INVALID_CREDENTIALS");
      const trusted = context(recoveryContext);
      const transaction = await this.repository.claimRecoveryPasswordUpdate(trusted.interactionHash, new Date(trusted.now));
      if (transaction === null) return fail();
      const record = claimedUpdate(transaction, trusted.interactionHash, trusted.now);
      const credentials = canonicalCredentials(decryptToken(record.encryptedRecoveryToken, { recordId: record.id, tokenKind: "recovery" }, this.keyring));
      await this.provider.updatePassword({ ...credentials, userId: record.userId!, password: password.data.password });
      const consumed = await this.repository.consumeRecoveryAndRevokeSessions({ transactionId: record.id, userId: record.userId!, expectedPasswordUpdateClaimedAt: new Date(record.passwordUpdateClaimedAt!), now: new Date(trusted.now) });
      if (!consumed) return fail();
      return { updated: true };
    } catch (error) {
      if (error instanceof PasswordRecoveryServiceError || error instanceof AuthProviderError) return providerFailure(error);
      return fail();
    }
  }
}
