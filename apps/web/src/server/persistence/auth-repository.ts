import type { TokenEnvelope } from "../security/token-envelope.js";
import type { AuthProvider } from "@account-book/contracts";

/** A server-only persisted opaque session. Token values are always encrypted envelopes. */
export type AuthSessionRecord = Readonly<{
  id: string;
  selectorHash: Uint8Array;
  userId: string;
  supabaseSessionId: string;
  encryptedAccessToken: TokenEnvelope;
  encryptedRefreshToken: TokenEnvelope;
  accessTokenExpiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revocationPendingAt: Date | null;
  rotationVersion: number;
}>;

/** Complete encrypted input for creating an opaque session row. */
export type NewSessionRecord = AuthSessionRecord;

/** CAS preconditions and encrypted replacement data for exactly one token rotation. */
export type RotateSessionInput = Readonly<{
  sessionId: string;
  expectedRotationVersion: number;
  expectedSupabaseSessionId: string;
  encryptedAccessToken: TokenEnvelope;
  encryptedRefreshToken: TokenEnvelope;
  supabaseSessionId: string;
  accessTokenExpiresAt: Date;
  now: Date;
}>;

/** Persisted OAuth transaction containing only digests and an encrypted PKCE verifier. */
export type OAuthTransactionRecord = Readonly<{
  id: string;
  stateHash: Uint8Array;
  interactionHash: Uint8Array;
  provider: AuthProvider;
  encryptedPkceVerifier: TokenEnvelope;
  returnPath: "/app" | "/settings/security";
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}>;

/** Exact live-row predicates required to claim one OAuth code exchange. */
export type ClaimOAuthTransactionInput = Readonly<{
  provider: AuthProvider;
  stateHash: Uint8Array;
  interactionHash: Uint8Array;
  now: Date;
}>;

/** Persisted email-confirmation transaction containing one encrypted PKCE verifier. */
export type EmailConfirmationTransactionRecord = Readonly<{
  id: string;
  interactionHash: Uint8Array;
  encryptedPkceVerifier: TokenEnvelope;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}>;

/** Auditable fail-closed recovery transaction across pending, exchanged, update-claimed, and consumed stages. */
export type RecoveryTransactionRecord = Readonly<{
  id: string;
  interactionHash: Uint8Array;
  encryptedPkceVerifier: TokenEnvelope | null;
  userId: string | null;
  encryptedRecoveryToken: TokenEnvelope | null;
  createdAt: Date;
  expiresAt: Date;
  exchangeClaimedAt: Date | null;
  exchangedAt: Date | null;
  passwordUpdateClaimedAt: Date | null;
  consumedAt: Date | null;
}>;

/** CAS input that promotes exactly one claimed recovery exchange to encrypted credentials. */
export type PromoteRecoveryExchangeInput = Readonly<{
  transactionId: string;
  expectedExchangeClaimedAt: Date;
  userId: string;
  encryptedRecoveryToken: TokenEnvelope;
  now: Date;
}>;

/** CAS input that consumes one password update and revokes the user's local sessions atomically. */
export type ConsumeRecoveryInput = Readonly<{
  transactionId: string;
  userId: string;
  expectedPasswordUpdateClaimedAt: Date;
  now: Date;
}>;

/** Server-only persistence boundary; plaintext provider tokens never cross this port. */
export interface AuthRepository {
  /**
   * 사용자의 토큰 발급 허용 기준을 잠금으로 확인하고 암호화된 앱 세션을 저장합니다. 오래된 제공자 토큰으로 세션이 재생성되는 것을 막습니다.
   * @param input 저장할 세션 레코드; 토큰은 암호화된 상태.
   * @param providerIssuedAtSeconds 제공자 JWT 발급 시각(초).
   * @returns 저장 성공 시 true, 입력·발급 기준 거부 시 false.
   * @throws DB 오류는 호출자에게 전달됩니다.
   */
  createSession(input: NewSessionRecord, providerIssuedAtSeconds: number): Promise<boolean>;
  /**
   * 식별자 해시로 폐기되지 않고 절대 만료·7일 유휴 만료를 지나지 않은 세션을 최대 한 개 조회합니다. 조회만으로 수명은 늘어나지 않습니다.
   * @param hash 브라우저 식별자의 32바이트 해시.
   * @param now 활성 여부 판단 시각.
   * @returns 활성 레코드 또는 없거나 잘못된 데이터이면 null.
   * @throws DB 조회 오류.
   */
  findActiveBySelectorHash(hash: Uint8Array, now: Date): Promise<AuthSessionRecord | null>;
  /**
   * 기대 버전과 제공자 세션 ID가 여전히 일치하는 활성 세션만 두 암호화 토큰으로 교체합니다. 버전과 마지막 사용 시각도 갱신합니다.
   * @param input 비교 조건·교체할 암호문·만료 및 현재 시각.
   * @returns 정확히 한 행을 갱신하면 true, 검증 실패나 경합 시 false.
   * @throws DB 갱신 오류.
   */
  rotate(input: RotateSessionInput): Promise<boolean>;
  /**
   * 식별자 해시가 일치하는 미폐기 세션에 폐기 시각을 기록합니다. 제공자 로그아웃 요청은 하지 않습니다.
   * @param hash 폐기할 브라우저 식별자 해시.
   * @param now 기록할 폐기 시각.
   * @returns 정확히 한 행을 폐기하면 true.
   * @throws DB 갱신 오류.
   */
  revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean>;
  /**
   * 한 사용자에게 속한 미폐기 로컬 세션 전부에 폐기 시각을 기록합니다.
   * @param userId 대상 사용자 UUID.
   * @param now 폐기 기준 시각.
   * @returns 변경된 세션 수; 잘못된 입력은 0.
   * @throws DB 갱신 오류.
   */
  revokeAllForUser(userId: string, now: Date): Promise<number>;
  /**
   * 이미 로컬에서 폐기된 세션에 제공자 로그아웃 재처리가 필요함을 기록합니다.
   * @param sessionId 대상 앱 세션 UUID.
   * @param now 보류 상태 기록 시각.
   * @returns 완료 후 값 없음; 잘못된 입력은 변경 없이 종료합니다.
   * @throws DB 갱신 오류.
   */
  markRevocationPending(sessionId: string, now: Date): Promise<void>;
  /**
   * OAuth 연결용 해시와 암호화된 PKCE 비밀값을 새 트랜잭션으로 저장합니다.
   * @param input 저장할 OAuth 트랜잭션.
   * @returns 저장이 끝나면 값 없이 완료합니다.
   * @throws DB 저장 오류.
   */
  createOAuthTransaction(input: OAuthTransactionRecord): Promise<void>;
  /**
   * 제공자·state·브라우저 해시가 일치하는 미사용·미만료 OAuth 요청을 한 번의 갱신으로 소비합니다.
   * @param input 정확한 조회 조건과 소비 시각.
   * @returns 한 행을 얻으면 소비된 레코드, 재사용·만료·경합 등은 null.
   * @throws DB 갱신 오류.
   */
  claimOAuthTransaction(input: ClaimOAuthTransactionInput): Promise<OAuthTransactionRecord | null>;
  /**
   * 브라우저 해시와 암호화한 PKCE 비밀값으로 이메일 확인 요청을 저장합니다.
   * @param input 이메일 확인 레코드.
   * @returns 저장이 끝나면 값 없이 완료합니다.
   * @throws DB 저장 오류.
   */
  createEmailConfirmationTransaction(input: EmailConfirmationTransactionRecord): Promise<void>;
  /**
   * 현재 브라우저의 미사용·미만료 이메일 확인 요청을 갱신하면서 소비해 재사용을 막습니다.
   * @param interactionHash 브라우저 식별자 해시.
   * @param now 소비 및 만료 판단 시각.
   * @returns 정확히 한 행이 소비되면 레코드, 아니면 null.
   * @throws DB 갱신 오류.
   */
  claimEmailConfirmationTransaction(interactionHash: Uint8Array, now: Date): Promise<EmailConfirmationTransactionRecord | null>;
  /**
   * 복구 PKCE 비밀값과 단계별 상태를 새 복구 트랜잭션으로 저장합니다.
   * @param input 초기 복구 레코드.
   * @returns 저장이 끝나면 값 없이 완료합니다.
   * @throws DB 저장 오류.
   */
  createRecoveryTransaction(input: RecoveryTransactionRecord): Promise<void>;
  /**
   * 아직 코드 교환되지 않은 유효 복구 레코드에 선점 시각을 기록합니다. 이후 다른 요청은 같은 교환을 선점할 수 없습니다.
   * @param interactionHash 브라우저 식별자 해시.
   * @param now 선점 및 만료 판단 시각.
   * @returns 선점한 한 레코드 또는 null.
   * @throws DB 갱신 오류.
   */
  claimRecoveryExchange(interactionHash: Uint8Array, now: Date): Promise<RecoveryTransactionRecord | null>;
  /**
   * 선점 시각이 일치하는 레코드의 PKCE 비밀값을 지우고 검증된 사용자·암호화 복구 토큰·교환 완료 시각을 저장합니다.
   * @param input 대상 ID·기대 선점 시각·사용자·암호문·현재 시각.
   * @returns 정확히 한 행이 다음 단계로 바뀌면 true.
   * @throws DB 갱신 오류.
   */
  promoteRecoveryExchange(input: PromoteRecoveryExchangeInput): Promise<boolean>;
  /**
   * 코드 교환은 완료됐지만 비밀번호 변경은 아직 선점되지 않은 유효 복구 레코드를 선점합니다.
   * @param interactionHash 현재 브라우저 식별자 해시.
   * @param now 선점 및 만료 판단 시각.
   * @returns 선점한 레코드 또는 null.
   * @throws DB 갱신 오류.
   */
  claimRecoveryPasswordUpdate(interactionHash: Uint8Array, now: Date): Promise<RecoveryTransactionRecord | null>;
  /**
   * 복구 소비·사용자의 최소 허용 토큰 발급 시각 상향·모든 로컬 세션 폐기를 하나의 DB 트랜잭션으로 처리합니다.
   * @param input 복구 ID·사용자·기대 갱신 선점 시각·현재 시각.
   * @returns 모든 저장이 성공하면 true, 입력이나 소비 조건이 불일치하면 false.
   * @throws DB 오류 또는 사용자 보안 상태 잠금 실패; 트랜잭션을 롤백합니다.
   */
  consumeRecoveryAndRevokeSessions(input: ConsumeRecoveryInput): Promise<boolean>;
}
