import { CreateTransactionInputSchema, UpdateTransactionInputSchema, DeleteTransactionInputSchema, LedgerIdSchema, TransactionSchema, TransactionListQuerySchema, type UpdateTransactionInput, type DeleteTransactionInput, type CreateTransactionInput, type Transaction, type TransactionListQuery, type TransactionListResponse } from "@account-book/contracts";
import { CoreError } from "../core/core-error.js";
import { idempotentCreate } from "../core/idempotency.js";
import { input } from "../core/validation.js";
import { UserDatabase } from "../core/user-database.js";
import { decodeCursor, encodeCursor } from "./transaction-cursor.js";
import { transaction } from "./transaction-mapping.js";
import { updateTransaction, deleteTransaction } from "./transaction-changes.js";

/** 사용자별 RLS transaction 안에서 거래만 다룬다. 이체·시작 잔액 생성은 별도 명령의 책임이다. */
export class TransactionsRepository {
  /** @param database 최소 권한 사용자 transaction 경계. */
  public constructor(private readonly database: UserDatabase) {}
  /** @param userId 인증 소유자. @param id 거래 UUID. @param raw 변경값과 기대 버전. 삭제/타인 거래는 같은 404다. */
  public async update(userId: string, id: string, raw: UpdateTransactionInput): Promise<Transaction> {
    const target = input(LedgerIdSchema, id), value = input(UpdateTransactionInputSchema, raw);
    return this.database.run(userId, client => updateTransaction(client, userId, target, value));
  }
  /** @param userId 인증 소유자. @param id 거래 UUID. @param raw 기대 버전. 재삭제는 404이며 기존 기록을 부활시키지 않는다. */
  public async remove(userId: string, id: string, raw: DeleteTransactionInput) {
    const target = input(LedgerIdSchema, id), value = input(DeleteTransactionInputSchema, raw);
    return this.database.run(userId, client => deleteTransaction(client, userId, target, value.expectedVersion));
  }
  /** @param userId 인증 소유자. @param query 필터/커서/페이지 크기. @returns 삭제 제외, 최신 날짜·UUID순 한 페이지. */
  public async list(userId: string, query: TransactionListQuery): Promise<TransactionListResponse> {
    const value = input(TransactionListQuerySchema, query), cursor = decodeCursor(userId, value), limit = value.limit ?? 50;
    return this.database.run(userId, async client => {
      const result = await client.query(`select t.*,t.occurred_on::text as occurred_on from finance.transaction_history t
        where user_id=$1 and deleted_at is null
        and ($2::uuid is null or account_id=$2) and ($3::uuid is null or category_id=$3)
        and ($4::date is null or occurred_on >= $4) and ($5::date is null or occurred_on <= $5)
        and ($6::text is null or kind=$6)
        and ($7::date is null or (occurred_on,id)<($7::date,$8::uuid))
        order by t.occurred_on desc,t.id desc limit $9`,
      [userId,value.accountId ?? null,value.categoryId ?? null,value.from ?? null,value.to ?? null,value.type ?? null,cursor?.date ?? null,cursor?.id ?? null,limit + 1]);
      const items = result.rows.slice(0, limit).map(transaction), last = items.at(-1);
      return { items, nextCursor: result.rows.length > limit && last ? encodeCursor(userId, value, last) : null };
    });
  }
  /** @param userId 인증 소유자. @param raw 수입/지출 및 동일 시도 키. @returns 최초 저장 snapshot; 부모 보관/종류 경쟁도 같은 transaction에서 검사한다. */
  public async create(userId: string, raw: CreateTransactionInput): Promise<Transaction> {
    const value = input(CreateTransactionInputSchema, raw);
    const payload = { accountId: value.accountId, categoryId: value.categoryId, type: value.type, amountKrw: value.amountKrw, occurredOn: value.occurredOn, memo: value.memo ?? null };
    return this.database.run(userId, client => idempotentCreate(client, userId, "create_transaction", value.idempotencyKey, payload, TransactionSchema, async () => {
      // DB trigger와 같은 계좌 → 분류 순서로 잠근다. 성공 재시도는 이 지점 전에 snapshot을 반환한다.
      const accounts = await client.query("select archived_at from finance.accounts where user_id=$1 and id=$2 for update", [userId,value.accountId]);
      const account = accounts.rows[0];
      if (!account) throw new CoreError("LEDGER_NOT_FOUND", 404);
      if (account.archived_at !== null) throw new CoreError("LEDGER_ACCOUNT_UNAVAILABLE", 409);
      const categories = await client.query("select kind,archived_at from finance.transaction_categories where user_id=$1 and id=$2 for update", [userId,value.categoryId]);
      const category = categories.rows[0];
      if (!category) throw new CoreError("LEDGER_NOT_FOUND", 404);
      if (category.archived_at !== null || category.kind !== value.type) throw new CoreError("LEDGER_CATEGORY_UNAVAILABLE", 409);
      const created = await client.query(`insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on,memo)
        values($1,$2,$3,$4,$5,$6,$7) returning *,occurred_on::text as occurred_on`,
      [userId,value.accountId,value.categoryId,value.type,value.amountKrw,value.occurredOn,value.memo ?? null]);
      return transaction(created.rows[0]);
    }));
  }
}
