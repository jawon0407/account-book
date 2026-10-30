import {
  AccountSchema, CreateAccountInputSchema, type Account, type AccountListResponse,
  type ArchiveAccountInput, type CreateAccountInput, type UpdateAccountInput,
} from "@account-book/contracts";
import { CoreError } from "../core/core-error.js";
import { idempotentCreate } from "../core/idempotency.js";
import { boundedRows, isoTimestamp, safeInteger } from "../core/serialization.js";
import { type DbClient, UserDatabase } from "../core/user-database.js";

// SUM(bigint)은 numeric이다. 문자열로 받아 아래 safeInteger에서 JSON의 정확한 정수 범위를 검사한다.
const ACCOUNT_SELECT = `select a.*,coalesce((select sum(case
  when t.kind in ('income','transfer_in') or (t.kind='opening_balance' and t.opening_direction='asset') then t.amount_krw
  else -t.amount_krw end) from finance.transaction_history t
  where t.user_id=a.user_id and t.account_id=a.id and t.deleted_at is null),0)::text as balance
  from finance.accounts a`;

/** @param row DB 내부 행. @returns 소유자/내부 열을 제외하고 계약으로 검증한 계좌. */
function account(row: Record<string, unknown>): Account {
  return AccountSchema.parse({ id: row.id, kind: row.kind, name: row.name, version: safeInteger(row.version),
    currentBalanceKrw: safeInteger(row.balance), archivedAt: row.archived_at === null ? null : isoTimestamp(row.archived_at),
    createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at) });
}

/** 개인 장부 계좌 저장소. bank 종류를 생성해도 실제 은행 계좌가 연결되지는 않는다. */
export class AccountsRepository {
  /** @param database 인증 사용자 transaction 경계. */
  public constructor(private readonly database: UserDatabase) {}
  /** @param userId 소유자 UUID. @param includeArchived 보관 항목 포함. @returns 생성 순으로 정렬한 계좌와 실제 원장 잔액. */
  public list(userId: string, includeArchived: boolean): Promise<AccountListResponse> {
    return this.database.run(userId, async client => {
      const result = await client.query(`${ACCOUNT_SELECT} where a.user_id=$1 and ($2::boolean or a.archived_at is null) order by a.created_at,a.id limit 1001`, [userId, includeArchived]);
      return { items: boundedRows(result.rows).map(account) };
    });
  }
  /** @param userId 소유자. @param input 생성 내용/요청 키. @returns 최초 생성 snapshot; 같은 키로 두 번 생성하지 않는다. */
  public create(userId: string, input: CreateAccountInput): Promise<Account> {
    const value = CreateAccountInputSchema.parse(input);
    return this.database.run(userId, client => idempotentCreate(client, userId, "create_account", value.idempotencyKey,
      { kind: value.kind, name: value.name }, AccountSchema, async () => {
        const created = await client.query("insert into finance.accounts(user_id,kind,name) values($1,$2,$3) returning id", [userId, value.kind, value.name]);
        return this.read(client, userId, created.rows[0].id);
      }));
  }
  /** @param userId 소유자. @param id 계좌 ID. @param input 이름/기대 버전. @returns 성공 시 증가한 버전. */
  public update(userId: string, id: string, input: UpdateAccountInput): Promise<Account> {
    return this.change(userId, id, input.expectedVersion, input.name, false);
  }
  /** @param userId 소유자. @param id 계좌 ID. @param input 기대 버전. @returns 삭제하지 않고 보관한 계좌. */
  public archive(userId: string, id: string, input: ArchiveAccountInput): Promise<Account> {
    return this.change(userId, id, input.expectedVersion, undefined, true);
  }
  /** @param client 요청 연결. @param userId 소유자. @param id 계좌 ID. @returns 본인 계좌, 타인/부재는 동일404. */
  private async read(client: DbClient, userId: string, id: string): Promise<Account> {
    const result = await client.query(`${ACCOUNT_SELECT} where a.user_id=$1 and a.id=$2`, [userId, id]);
    if (!result.rows[0]) throw new CoreError("LEDGER_NOT_FOUND", 404);
    return account(result.rows[0]);
  }
  /** @param userId 소유자. @param id 계좌. @param version 기대 버전. @param name 새 이름. @param archive 보관 여부. @returns 변경 후 계좌. */
  private change(userId: string, id: string, version: number, name: string | undefined, archive: boolean): Promise<Account> {
    return this.database.run(userId, async client => {
      const result = archive
        ? await client.query("update finance.accounts set archived_at=now() where user_id=$1 and id=$2 and version=$3 and archived_at is null returning id", [userId, id, version])
        : await client.query("update finance.accounts set name=$4 where user_id=$1 and id=$2 and version=$3 and archived_at is null returning id", [userId, id, version, name]);
      const current = await this.read(client, userId, id);
      if (result.rowCount !== 1) throw new CoreError(current.archivedAt !== null ? "LEDGER_ACCOUNT_UNAVAILABLE" : "LEDGER_VERSION_CONFLICT", 409);
      return current;
    });
  }
}
