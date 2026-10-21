import { ProfileSchema, UpdateProfileInputSchema, type Profile, type UpdateProfileInput } from "@account-book/contracts";
import { CoreError } from "../core/core-error.js";
import { isoTimestamp, safeInteger } from "../core/serialization.js";
import { type DbClient, UserDatabase } from "../core/user-database.js";
import { input } from "../core/validation.js";

/** Auth 계정이 아닌 앱 프로필을 다루며 역할·가입 경로·탈퇴 상태를 수정하지 않는다. */
export class ProfilesRepository {
  /** @param database 사용자별 transaction 경계. */
  public constructor(private readonly database: UserDatabase) {}
  /** @param userId 검증된 본인 UUID. @returns 활성 프로필과 현재 앱 역할. */
  public get(userId: string): Promise<Profile> { return this.database.run(userId, client => this.read(client, userId)); }
  /** @param userId 본인 UUID. @param raw 닉네임/거주 시간대/기대 버전. 이력과 프로필을 함께 commit하거나 rollback한다. */
  public async update(userId: string, raw: UpdateProfileInput): Promise<Profile> {
    const value = input(UpdateProfileInputSchema, raw, true);
    return this.database.run(userId, async client => {
      const locked = await client.query('select nickname,version from "user".users where user_id=$1 and deleted_at is null for update', [userId]);
      if (!locked.rows[0]) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
      if (safeInteger(locked.rows[0].version) !== value.expectedVersion) throw new CoreError("PROFILE_VERSION_CONFLICT", 409);
      if (value.ledgerTimeZone !== undefined) {
        const valid = await client.query('select "user".is_ledger_time_zone($1) as valid', [value.ledgerTimeZone]);
        if (valid.rows[0]?.valid !== true) throw new CoreError("PROFILE_VALIDATION_FAILED", 400);
        const current = await client.query('select time_zone from "user".ledger_time_history where user_id=$1 order by revision desc limit 1', [userId]);
        if (current.rows[0]?.time_zone.toLowerCase() !== value.ledgerTimeZone.toLowerCase())
          await client.query('insert into "user".ledger_time_history(user_id,time_zone) values($1,$2)', [userId, value.ledgerTimeZone]);
      }
      const nickname = value.nickname === undefined ? locked.rows[0].nickname : value.nickname;
      const result = await client.query("update \"user\".users set nickname=$2 where user_id=$1 and version=$3 and deleted_at is null returning user_id", [userId, nickname, value.expectedVersion]);
      if (result.rowCount !== 1) throw new CoreError("PROFILE_VERSION_CONFLICT", 409);
      return this.read(client, userId);
    });
  }
  /** @param client 같은 transaction 연결. @param userId 본인 UUID. @returns 명시적으로 고른 공개 필드만. */
  private async read(client: DbClient, userId: string): Promise<Profile> {
    const result = await client.query(`select p.*,r.role,
      (select time_zone from "user".ledger_time_history h where h.user_id=p.user_id order by revision desc limit 1) as ledger_time_zone
      from "user".users p join "user".roles r on r.user_id=p.user_id where p.user_id=$1 and p.deleted_at is null`, [userId]);
    const row = result.rows[0];
    if (!row) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
    return ProfileSchema.parse({ id: row.user_id, nickname: row.nickname, avatarObjectKey: row.avatar_object_key,
      signupProvider: row.signup_provider, role: row.role, version: safeInteger(row.version), ledgerTimeZone: row.ledger_time_zone,
      createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at) });
  }
}
