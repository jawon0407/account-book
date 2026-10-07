import { ProfileSchema, type Profile, type UpdateProfileInput } from "@account-book/contracts";
import { CoreError } from "../core/core-error.js";
import { isoTimestamp, safeInteger } from "../core/serialization.js";
import { type DbClient, UserDatabase } from "../core/user-database.js";

/** Auth 계정이 아닌 앱 프로필을 다루며 역할·가입 경로·탈퇴 상태를 수정하지 않는다. */
export class ProfilesRepository {
  /** @param database 사용자별 transaction 경계. */
  public constructor(private readonly database: UserDatabase) {}
  /** @param userId 검증된 본인 UUID. @returns 활성 프로필과 현재 앱 역할. */
  public get(userId: string): Promise<Profile> { return this.database.run(userId, client => this.read(client, userId)); }
  /** @param userId 본인 UUID. @param input 닉네임/기대 버전. @returns 수정 후 버전의 프로필. */
  public update(userId: string, input: UpdateProfileInput): Promise<Profile> {
    return this.database.run(userId, async client => {
      const result = await client.query("update \"user\".users set nickname=$2 where user_id=$1 and version=$3 and deleted_at is null returning user_id", [userId, input.nickname, input.expectedVersion]);
      if (result.rowCount !== 1) throw new CoreError("PROFILE_VERSION_CONFLICT", 409);
      return this.read(client, userId);
    });
  }
  /** @param client 같은 transaction 연결. @param userId 본인 UUID. @returns 명시적으로 고른 공개 필드만. */
  private async read(client: DbClient, userId: string): Promise<Profile> {
    const result = await client.query("select p.*,r.role from \"user\".users p join \"user\".roles r on r.user_id=p.user_id where p.user_id=$1 and p.deleted_at is null", [userId]);
    const row = result.rows[0];
    if (!row) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
    return ProfileSchema.parse({ id: row.user_id, nickname: row.nickname, avatarObjectKey: row.avatar_object_key,
      signupProvider: row.signup_provider, role: row.role, version: safeInteger(row.version),
      createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at) });
  }
}
