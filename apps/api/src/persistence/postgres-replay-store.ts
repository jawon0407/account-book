import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import {
  ReplayInputInvalidError,
  type ReplayStore,
  ReplayStoreUnavailableError,
} from "./replay-store.js";

/**
 * PostgreSQL replay adapter that atomically inserts only copied SHA-256 digests.
 * It owns the supplied process pool lifecycle and maps every driver/result failure
 * to a fixed error without logging or retaining database, query, digest, or expiry detail.
 */
export class PostgresReplayStore implements ReplayStore, OnApplicationShutdown {
  private closed = false;
  private shutdownPromise: Promise<void> | undefined;

  /**
   * API 프로세스의 DB 연결 풀을 받아 재사용 차단 저장소로 감싼다.
   * @param database - 매개변수 쿼리와 종료 기능을 제공하는 연결 풀.
   * @remarks 생성 시 쿼리는 실행하지 않으며 애플리케이션 종료 시 이 풀을 닫을 책임을 가진다.
   */
  public constructor(private readonly database: Pick<Pool, "end" | "query">) {}

  /**
   * 단일 INSERT와 기본키 충돌 처리를 이용해 동시 요청에서도 같은 해시를 한 번만 기록한다.
   * @param jtiDigest - 정확히 32바이트 SHA-256. 호출자 배열 변경을 막기 위해 복사 후 전달한다.
   * @param expiresAt - 행의 만료 시각으로 저장할 유효한 Date.
   * @returns 삽입 행이 1개이면 true, 이미 존재해 삽입하지 않았으면 false.
   * @throws 입력 오류는 ReplayInputInvalidError, 닫힌 풀·DB 오류·예상 밖 결과는 ReplayStoreUnavailableError.
   * @remarks app_private.api_jwt_replays에 쓰지만 토큰 원문을 저장하거나 만료 행을 삭제하지 않는다.
   */
  public async consume(jtiDigest: Uint8Array, expiresAt: Date): Promise<boolean> {
    if (
      !(jtiDigest instanceof Uint8Array)
      || jtiDigest.byteLength !== 32
      || !(expiresAt instanceof Date)
    ) {
      throw new ReplayInputInvalidError();
    }

    let expiresAtMilliseconds: number;
    let copiedDigest: Buffer;
    try {
      expiresAtMilliseconds = expiresAt.getTime();
      copiedDigest = Buffer.from(jtiDigest);
    } catch {
      throw new ReplayInputInvalidError();
    }
    if (!Number.isFinite(expiresAtMilliseconds)) throw new ReplayInputInvalidError();
    if (this.closed) throw new ReplayStoreUnavailableError();

    let rowCount: number | null | undefined;
    try {
      const result = await this.database.query({
        name: "consume-api-jwt-replay",
        text: "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, $2) on conflict do nothing",
        values: [copiedDigest, expiresAt],
      });
      rowCount = result?.rowCount;
    } catch {
      throw new ReplayStoreUnavailableError();
    }

    if (rowCount === 1) return true;
    if (rowCount === 0) return false;
    throw new ReplayStoreUnavailableError();
  }

  /**
   * Nest 종료 훅에서 새 사용 기록을 막고 연결 풀을 한 번만 닫는다.
   * @returns 여러 번 호출해도 공유하는 종료 Promise.
   * @throws 풀 종료 실패 시 내부 정보를 숨긴 ReplayStoreUnavailableError.
   */
  public onApplicationShutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.closed = true;
      this.shutdownPromise = this.closeDatabase();
    }
    return this.shutdownPromise;
  }

  /**
   * 실제 연결 풀 종료를 기다리며 드라이버 오류를 공개 가능한 고정 오류로 바꾼다.
   * @returns DB 풀 종료가 끝나면 완료되는 Promise.
   * @throws 종료 실패 시 ReplayStoreUnavailableError.
   */
  private async closeDatabase(): Promise<void> {
    try {
      await this.database.end();
    } catch {
      throw new ReplayStoreUnavailableError();
    }
  }
}
