import {
  CategorySchema, CreateCategoryInputSchema, type Category, type CategoryListResponse,
  type ArchiveCategoryInput, type CreateCategoryInput, type UpdateCategoryInput,
} from "@account-book/contracts";
import { CoreError } from "../core/core-error.js";
import { idempotentCreate } from "../core/idempotency.js";
import { boundedRows, isoTimestamp, safeInteger } from "../core/serialization.js";
import { UserDatabase } from "../core/user-database.js";

/** @param row 내부 DB 행. @returns 공개 카테고리 필드만 계약으로 검증한 값. */
function category(row: Record<string, unknown>): Category {
  return CategorySchema.parse({ id: row.id, kind: row.kind, name: row.name, sortOrder: row.sort_order,
    version: safeInteger(row.version), archivedAt: row.archived_at === null ? null : isoTimestamp(row.archived_at),
    createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at) });
}

/** 종류는 불변이고 이름·순서·보관만 변경하는 개인 분류 저장소. */
export class CategoriesRepository {
  /** @param database 인증 사용자 transaction 경계. */
  public constructor(private readonly database: UserDatabase) {}
  /** @param userId 소유자. @param includeArchived 보관 포함 여부. @returns 순서/이름/ID로 안정 정렬한 분류. */
  public list(userId: string, includeArchived: boolean): Promise<CategoryListResponse> {
    return this.database.run(userId, async client => {
      const result = await client.query("select * from finance.transaction_categories where user_id=$1 and ($2::boolean or archived_at is null) order by sort_order,name,id limit 1001", [userId, includeArchived]);
      return { items: boundedRows(result.rows).map(category) };
    });
  }
  /** @param userId 소유자. @param input 생성 내용/키. @returns 원자적으로 저장한 첫 성공 결과. */
  public create(userId: string, input: CreateCategoryInput): Promise<Category> {
    const value = CreateCategoryInputSchema.parse(input);
    return this.database.run(userId, client => idempotentCreate(client, userId, "create_category", value.idempotencyKey,
      { kind: value.kind, name: value.name, sortOrder: value.sortOrder }, CategorySchema, async () => {
        const created = await client.query("insert into finance.transaction_categories(user_id,kind,name,sort_order) values($1,$2,$3,$4) returning *", [userId, value.kind, value.name, value.sortOrder]);
        return category(created.rows[0]);
      }));
  }
  /** @param userId 소유자. @param id 분류 ID. @param input 이름/정렬/기대 버전. @returns 변경 후 분류. */
  public update(userId: string, id: string, input: UpdateCategoryInput): Promise<Category> { return this.change(userId, id, input, false); }
  /** @param userId 소유자. @param id 분류 ID. @param input 기대 버전. @returns 보관한 분류; 기존 거래 연결 유지. */
  public archive(userId: string, id: string, input: ArchiveCategoryInput): Promise<Category> { return this.change(userId, id, input, true); }
  /** @param userId 소유자. @param id 분류. @param input 변경 및 버전. @param archive 보관 여부. @returns 성공한 최종 행. */
  private change(userId: string, id: string, input: UpdateCategoryInput, archive: boolean): Promise<Category> {
    return this.database.run(userId, async client => {
      const result = archive
        ? await client.query("update finance.transaction_categories set archived_at=now() where user_id=$1 and id=$2 and version=$3 and archived_at is null returning *", [userId, id, input.expectedVersion])
        : await client.query("update finance.transaction_categories set name=coalesce($4,name),sort_order=coalesce($5,sort_order) where user_id=$1 and id=$2 and version=$3 and archived_at is null returning *", [userId, id, input.expectedVersion, input.name, input.sortOrder]);
      if (result.rowCount === 1) return category(result.rows[0]);
      const old = await client.query("select archived_at from finance.transaction_categories where user_id=$1 and id=$2", [userId, id]);
      if (!old.rows[0]) throw new CoreError("LEDGER_NOT_FOUND", 404);
      throw new CoreError(old.rows[0].archived_at !== null ? "LEDGER_CATEGORY_UNAVAILABLE" : "LEDGER_VERSION_CONFLICT", 409);
    });
  }
}
