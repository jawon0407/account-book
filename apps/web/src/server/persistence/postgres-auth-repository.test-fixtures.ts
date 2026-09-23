import { randomBytes } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm/sql";
import { expect } from "vitest";

type TokenEnvelope = Readonly<{ version: 1; keyId: string; iv: string; ciphertext: string; tag: string }>;
const repositoryModule = await import("./postgres-auth-repository.js").catch(() => ({} as Record<string, unknown>));
const PostgresAuthRepository = repositoryModule.PostgresAuthRepository as
  | (new (database: FakeDatabase) => {
      createSession(input: Record<string, unknown>, providerIssuedAtSeconds: number): Promise<boolean>;
      findActiveBySelectorHash(hash: Uint8Array, now: Date): Promise<unknown>;
      rotate(input: Record<string, unknown>): Promise<boolean>;
      revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean>;
      revokeAllForUser(userId: string, now: Date): Promise<number>;
      markRevocationPending(sessionId: string, now: Date): Promise<void>;
      createOAuthTransaction(input: Record<string, unknown>): Promise<void>;
      claimOAuthTransaction(input: Record<string, unknown>): Promise<unknown>;
      createEmailConfirmationTransaction(input: Record<string, unknown>): Promise<void>;
      claimEmailConfirmationTransaction(hash: Uint8Array, now: Date): Promise<unknown>;
      createRecoveryTransaction(input: Record<string, unknown>): Promise<void>;
      claimRecoveryExchange(hash: Uint8Array, now: Date): Promise<unknown>;
      promoteRecoveryExchange(input: Record<string, unknown>): Promise<boolean>;
      claimRecoveryPasswordUpdate(hash: Uint8Array, now: Date): Promise<unknown>;
      consumeRecoveryAndRevokeSessions(input: Record<string, unknown>): Promise<boolean>;
    })
  | undefined;

const now = new Date("2026-07-20T12:00:00.000Z");
const id = "123e4567-e89b-12d3-a456-426614174000";
const userId = "123e4567-e89b-12d3-a456-426614174001";
const providerSessionId = "123e4567-e89b-12d3-a456-426614174002";
const envelope: TokenEnvelope = { version: 1, keyId: "current", iv: "A".repeat(16), ciphertext: "A", tag: "A".repeat(22) };

/**
 * 정상 암호화 세션 행을 기준으로 원하는 필드를 덮어써 DB 행 사례를 만듭니다.
 * @param overrides 바꿀 DB 행 필드.
 * @returns 테스트 세션 행 객체.
 */
function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    selectorHash: randomBytes(32),
    userId,
    supabaseSessionId: providerSessionId,
    encryptedAccessToken: envelope,
    encryptedRefreshToken: envelope,
    accessTokenExpiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    revocationPendingAt: null,
    rotationVersion: 0,
    ...overrides,
  };
}

class FakeDatabase {
  public readonly calls: Array<{ kind: string; table?: string | undefined; values?: Record<string, unknown>; predicates?: unknown; conflict?: boolean }> = [];
  public affectedRows: unknown[] = [{}];
  public securityRows: unknown[] = [{ minimumAcceptedIat: 0 }];
  public rows: unknown[] = [];

  /**
   * values 호출에서 테이블과 입력을 기록하고, onConflictDoNothing 호출 시 중복 무시 표시를 남기는 삽입 대역입니다. DB에는 접속하지 않습니다.
   * @param table 삽입 대상 Drizzle 테이블; 생략 가능.
   * @returns 입력 기록용 values와 중복 무시 표시 메서드를 가진 체인.
   */
  public insert(table?: object): { values: (values: Record<string, unknown>) => Promise<void> & { onConflictDoNothing: () => Promise<void> } } {
    return { values: (values) => {
      const call: { kind: string; table?: string | undefined; values: Record<string, unknown>; conflict?: boolean } = { kind: "insert", table: table?.[Symbol.for("drizzle:Name") as never] as string | undefined, values };
      this.calls.push(call);
      return Object.assign(Promise.resolve(), { onConflictDoNothing: async () => { call.conflict = true; } });
    } };
  }

  /**
   * from→where→limit 모양을 흉내 내며 최종 호출에서 조건을 기록하고 설정한 rows를 반환합니다.
   * @returns 조회 체인 대역; where는 기록할 조건을 받고 limit은 준비된 행 목록을 반환합니다.
   */
  public select(): { from: () => { where: (predicates: unknown) => { limit: () => Promise<unknown[]> } } } {
    return { from: () => ({ where: (predicates) => ({ limit: async () => { this.calls.push({ kind: "select", predicates }); return this.rows; } }) }) };
  }

  /**
   * set→where→returning 호출을 기록하고 보안 상태 테이블이면 securityRows, 그 외에는 affectedRows를 반환합니다.
   * @param table 갱신 대상 Drizzle 테이블; 생략 가능.
   * @returns 변경값·조건을 받는 갱신 체인 대역.
   */
  public update(table?: object): { set: (values: Record<string, unknown>) => { where: (predicates: unknown) => { returning: () => Promise<unknown[]> } } } {
    return {
      set: (values) => ({ where: (predicates) => ({ returning: async () => {
        const tableName = table?.[Symbol.for("drizzle:Name") as never] as string | undefined;
        this.calls.push({ kind: "update", table: tableName, values, predicates });
        return tableName === "auth_user_security_state" ? this.securityRows : this.affectedRows;
      } }) }),
    };
  }

  /**
   * 전달 작업에 동일한 대역을 넘깁니다. 실제 DB 트랜잭션이나 롤백을 수행하지 않습니다.
   * @param operation 트랜잭션 내부를 흉내 낼 비동기 작업.
   * @returns 전달 작업의 결과.
   * @throws 전달 작업의 오류.
   */
  public async transaction<T>(operation: (transaction: FakeDatabase) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

/**
 * Drizzle SQL 객체를 PostgreSQL 문자열과 매개변수로 변환해 조건을 assertion에서 검사할 수 있게 합니다.
 * @param value 변환할 SQL 표현식.
 * @returns SQL 문자열과 바인딩 매개변수 배열.
 */
function query(value: unknown): Readonly<{ sql: string; params: unknown[] }> {
  return new PgDialect().sqlToQuery(value as SQL);
}

/**
 * 저장소 구현이 존재하는지 확인하고 기록용 DB 대역과 연결합니다.
 * @param database 사용할 DB 기록 대역.
 * @returns DB 대역과 PostgresAuthRepository.
 */
function subject(database = new FakeDatabase()) {
  expect(PostgresAuthRepository).toBeTypeOf("function");
  return { database, repository: new PostgresAuthRepository!(database) };
}

export { FakeDatabase, now, id, userId, providerSessionId, envelope, session, query, subject };
