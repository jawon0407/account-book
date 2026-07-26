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
   * Creates an adapter around the API process's PostgreSQL pool.
   * @param database - Process-owned pool limited here to parameterized queries and shutdown.
   */
  public constructor(private readonly database: Pick<Pool, "end" | "query">) {}

  /**
   * Atomically consumes one digest with a single named parameterized insert.
   * @param jtiDigest - Exactly 32 SHA-256 bytes; the adapter copies them before driver handoff.
   * @param expiresAt - A finite valid `Date` used only as the replay row expiry.
   * @returns `true` only for one inserted row and `false` only for a conflict/no-op result.
   * @throws `ReplayInputInvalidError` for invalid values or `ReplayStoreUnavailableError`
   * for closed-pool, driver, or impossible result failures; errors contain no secret detail.
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
   * Closes the process-owned pool exactly once when Nest shuts down.
   * @returns The shared shutdown promise so concurrent/repeated hooks never close twice.
   * @throws `ReplayStoreUnavailableError` without retaining pool or driver failure detail.
   */
  public onApplicationShutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.closed = true;
      this.shutdownPromise = this.closeDatabase();
    }
    return this.shutdownPromise;
  }

  private async closeDatabase(): Promise<void> {
    try {
      await this.database.end();
    } catch {
      throw new ReplayStoreUnavailableError();
    }
  }
}
