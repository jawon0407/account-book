/** Injection token for the server-only delegated-JWT replay consumption boundary. */
export const REPLAY_STORE = Symbol("REPLAY_STORE");

/**
 * Fixed, detail-free failure for a digest or expiry that cannot satisfy the replay-store contract.
 * No rejected value is retained because callers may have supplied token-derived secret material.
 */
export class ReplayInputInvalidError extends Error {
  /** 잘못된 입력값을 저장하거나 노출하지 않는 고정 재사용 차단 입력 오류를 만든다. */
  public constructor() {
    super("REPLAY_INPUT_INVALID");
    this.name = "ReplayInputInvalidError";
  }
}

/**
 * Fixed, detail-free operational failure for unavailable or inconsistent replay persistence.
 * Driver errors, connection data, digests, expiries, and query details are intentionally discarded.
 */
export class ReplayStoreUnavailableError extends Error {
  /** DB 연결 정보나 쿼리 내용을 담지 않는 고정 저장소 장애 오류를 만든다. */
  public constructor() {
    super("REPLAY_STORE_UNAVAILABLE");
    this.name = "ReplayStoreUnavailableError";
  }
}

/**
 * Atomically consumes SHA-256 delegated-token identifier digests without persisting raw token data.
 */
export interface ReplayStore {
  /**
   * 검증된 토큰의 사용 사실을 원자적으로 기록하는 공개 저장소 규약이다.
   * @param jtiDigest - 토큰 ID 원문이 아닌 정확히 32바이트 SHA-256 해시.
   * @param expiresAt - 운영자가 만료 행을 정리할 때 사용할 유효한 만료 시각.
   * @returns 처음 기록했으면 true, 같은 해시가 이미 있으면 false.
   * @throws 잘못된 입력은 ReplayInputInvalidError, 저장소 장애는 ReplayStoreUnavailableError.
   * @remarks 성공하면 영속 저장소가 변경된다. 만료 행 삭제는 이 호출의 역할이 아니다.
   */
  consume(jtiDigest: Uint8Array, expiresAt: Date): Promise<boolean>;
}
