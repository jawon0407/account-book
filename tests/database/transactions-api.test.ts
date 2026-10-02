import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserDatabase } from "../../apps/api/src/core/user-database.js";
import { TransactionsRepository } from "../../apps/api/src/transactions/transactions.repository.js";
import { AccountsRepository } from "../../apps/api/src/accounts/accounts.repository.js";
import { CORE_URL, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedAccount, seedCategory, seedUser } from "./support/core-fixtures.js";

describe("transaction repository with real RLS", () => {
  let fixture: CoreDatabase, pool: Pool, repository: TransactionsRepository;
  beforeAll(async () => {
    fixture = await openCoreDatabase();
    const password = randomBytes(24).toString("hex");
    await fixture.admin.query(`create role transaction_api_runner login password '${password}' in role app_api`);
    const url = new URL(CORE_URL); url.username = "transaction_api_runner"; url.password = password;
    pool = new Pool({ connectionString: url.href, max: 4 }); repository = new TransactionsRepository(new UserDatabase(pool));
  });
  afterAll(async () => { await pool?.end(); if (fixture) { await fixture.admin.query("drop role transaction_api_runner"); await fixture.close(); } });
  /** @returns 서로 독립된 합성 사용자와 활성 계좌·지출 분류. */
  async function setup() {
    const user = await seedUser(fixture.admin), accountId = await seedAccount(fixture.admin, user), categoryId = await seedCategory(fixture.admin, user);
    return { user, accountId, categoryId };
  }
  /** @param value 합성 소유자/참조. @param amount 정확한 원화 정수. @returns DB가 발급한 거래 ID. */
  async function seed(value: Awaited<ReturnType<typeof setup>>, amount = 100) {
    return (await fixture.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) values($1,$2,$3,'expense',$4,'2026-10-01') returning id", [value.user, value.accountId, value.categoryId, amount])).rows[0].id as string;
  }
  it("paginates same-day UUID ties without duplicates and binds cursor to user/filters", async () => {
    const a = await setup(), b = await setup(), ids = [];
    for (let n = 0; n < 5; n++) ids.push(await seed(a));
    await seed(b);
    const first = await repository.list(a.user, { limit: 2 });
    const second = await repository.list(a.user, { limit: 2, cursor: first.nextCursor! });
    const third = await repository.list(a.user, { limit: 2, cursor: second.nextCursor! });
    expect([...first.items, ...second.items, ...third.items].map(row => row.id)).toEqual(ids.sort().reverse());
    expect(third.nextCursor).toBeNull();
    await expect(repository.list(b.user, { cursor: first.nextCursor! })).rejects.toMatchObject({ status: 400 });
    await expect(repository.list(a.user, { type: "expense", cursor: first.nextCursor! })).rejects.toMatchObject({ status: 400 });
    expect((await repository.list(a.user, { accountId: b.accountId })).items).toEqual([]);
  });
  it("excludes tombstones, keeps archived history, filters dates/kind/category and preserves max safe money", async () => {
    const a = await setup(), id = await seed(a), max = await seed(a, Number.MAX_SAFE_INTEGER);
    await fixture.admin.query("update finance.transaction_history set deleted_at=now() where id=$1", [id]);
    await fixture.admin.query("update finance.accounts set archived_at=now() where id=$1", [a.accountId]);
    const result = await repository.list(a.user, { accountId: a.accountId, categoryId: a.categoryId, from: "2026-10-01", to: "2026-10-01", type: "expense" });
    expect(result.items).toHaveLength(1); expect(result.items[0]).toMatchObject({ id: max, amountKrw: Number.MAX_SAFE_INTEGER, occurredOn: "2026-10-01", kind: "expense" });
    expect(result.items[0]).not.toHaveProperty("userId");
    expect((await repository.list(a.user, { from: "2026-10-02" })).items).toEqual([]);
    expect((await repository.list(a.user, { type: "income" })).items).toEqual([]);
    await fixture.admin.query('update "user".users set deleted_at=now() where user_id=$1', [a.user]);
    await expect(repository.list(a.user, {})).rejects.toMatchObject({ status: 401 });
    await expect(repository.list(randomUUID(), {})).rejects.toMatchObject({ status: 401 });
  });
  it("defaults to 50 and uses limit+1 to expose a next page", async () => {
    const a = await setup();
    await fixture.admin.query("insert into finance.transaction_history(user_id,account_id,category_id,kind,amount_krw,occurred_on) select $1,$2,$3,'expense',n,'2026-10-01' from generate_series(1,51) n", [a.user,a.accountId,a.categoryId]);
    const result = await repository.list(a.user, {});
    expect(result.items).toHaveLength(50); expect(result.nextCursor).not.toBeNull();
  });
  it("creates once under concurrent retries, snapshots first result and rejects changed meaning", async () => {
    const a = await setup(), key = randomUUID();
    const value = { accountId: a.accountId, categoryId: a.categoryId, type: "expense" as const, amountKrw: 1200, occurredOn: "2026-10-01", memo: " 메모 ", idempotencyKey: key };
    const [first, again] = await Promise.all([repository.create(a.user, value), repository.create(a.user, { ...value, idempotencyKey: key.toUpperCase() })]);
    expect(first).toEqual(again); expect(first).toMatchObject({ kind: "expense", memo: "메모", version: 1 });
    expect((await repository.list(a.user, {})).items).toHaveLength(1);
    await fixture.admin.query("update finance.accounts set archived_at=now() where id=$1", [a.accountId]);
    expect(await repository.create(a.user, value)).toEqual(first);
    await expect(repository.create(a.user, { ...value, amountKrw: 1201 })).rejects.toMatchObject({ code: "LEDGER_IDEMPOTENCY_CONFLICT" });
    const b = await setup();
    expect((await repository.create(b.user, { ...value, accountId: b.accountId, categoryId: b.categoryId })).id).not.toBe(first.id);
  });
  it("rejects foreign/missing references, archived parents and mismatched category without dedup records", async () => {
    const a = await setup(), b = await setup(), key = randomUUID();
    const value = { accountId: a.accountId, categoryId: a.categoryId, type: "expense" as const, amountKrw: 1, occurredOn: "2026-10-01", idempotencyKey: key };
    for (const changed of [{ accountId: b.accountId }, { accountId: randomUUID() }, { categoryId: b.categoryId }, { categoryId: randomUUID() }])
      await expect(repository.create(a.user, { ...value, ...changed })).rejects.toMatchObject({ status: 404 });
    await expect(repository.create(a.user, { ...value, type: "income" })).rejects.toMatchObject({ code: "LEDGER_CATEGORY_UNAVAILABLE" });
    await fixture.admin.query("update finance.transaction_categories set archived_at=now() where id=$1", [a.categoryId]);
    await expect(repository.create(a.user, value)).rejects.toMatchObject({ code: "LEDGER_CATEGORY_UNAVAILABLE" });
    await fixture.admin.query("update finance.accounts set archived_at=now() where id=$1", [a.accountId]);
    await expect(repository.create(a.user, value)).rejects.toMatchObject({ code: "LEDGER_ACCOUNT_UNAVAILABLE" });
    expect((await repository.list(a.user, {})).items).toEqual([]);
    expect((await fixture.admin.query("select count(*)::int n from finance.request_deduplication where user_id=$1", [a.user])).rows[0].n).toBe(0);
  });
  it("reflects real income/expense balance and fails closed on aggregate overflow", async () => {
    const a = await setup(), income = await seedCategory(fixture.admin, a.user, "income"), accounts = new AccountsRepository(new UserDatabase(pool));
    const value = { accountId: a.accountId, categoryId: a.categoryId, type: "expense" as const, amountKrw: 200, occurredOn: "2026-10-01", idempotencyKey: randomUUID() };
    await repository.create(a.user, value);
    await repository.create(a.user, { ...value, type: "income", categoryId: income, amountKrw: 1000, idempotencyKey: randomUUID() });
    expect((await accounts.list(a.user, false)).items[0]?.currentBalanceKrw).toBe(800);
    await repository.create(a.user, { ...value, type: "income", categoryId: income, amountKrw: Number.MAX_SAFE_INTEGER, idempotencyKey: randomUUID() });
    await expect(accounts.list(a.user, false)).rejects.toMatchObject({ status: 503 });
  });
  it("updates amount/date/memo and moves balances between owned accounts with one new version", async () => {
    const a = await setup(), id = await seed(a), other = await seedAccount(fixture.admin, a.user), income = await seedCategory(fixture.admin, a.user, "income");
    const changed = await repository.update(a.user, id, { expectedVersion: 1, amountKrw: 500, memo: " 수정 ", occurredOn: "2026-09-30", accountId: other, type: "income", categoryId: income });
    expect(changed).toMatchObject({ id, version: 2, amountKrw: 500, memo: "수정", occurredOn: "2026-09-30", kind: "income", accountId: other, categoryId: income });
    expect((await repository.update(a.user, id, { expectedVersion: 2, amountKrw: 600 })).memo).toBe("수정");
    expect((await repository.update(a.user, id, { expectedVersion: 3, memo: null })).memo).toBeNull();
    const balances = (await new AccountsRepository(new UserDatabase(pool)).list(a.user, false)).items;
    expect(balances.find(row => row.id === a.accountId)?.currentBalanceKrw).toBe(0);
    expect(balances.find(row => row.id === other)?.currentBalanceKrw).toBe(600);
  });
  it("isolates users and validates shape, UUID and references without changing the row", async () => {
    const a = await setup(), b = await setup(), id = await seed(a);
    for (const target of [id, randomUUID()]) {
      await expect(repository.update(b.user, target, { expectedVersion: 1, memo: "x" })).rejects.toMatchObject({ status: 404 });
      await expect(repository.remove(b.user, target, { expectedVersion: 1 })).rejects.toMatchObject({ status: 404 });
    }
    for (const change of [{ accountId: b.accountId }, { categoryId: b.categoryId }])
      await expect(repository.update(a.user, id, { expectedVersion: 1, ...change })).rejects.toMatchObject({ status: 404 });
    await expect(repository.update(a.user, id, { expectedVersion: 1, type: "income" })).rejects.toMatchObject({ code: "LEDGER_CATEGORY_UNAVAILABLE" });
    for (const value of [{ expectedVersion: 1 }, { expectedVersion: 1, amountKrw: 0 }, { expectedVersion: 1, userId: b.user, memo: "x" }])
      await expect(repository.update(a.user, id, value as never)).rejects.toMatchObject({ status: 400 });
    await expect(repository.remove(a.user, "invalid", { expectedVersion: 1 })).rejects.toMatchObject({ status: 400 });
    expect((await repository.list(a.user, {})).items[0]).toMatchObject({ version: 1, amountKrw: 100 });
  });
  it("allows existing archived references but rejects selecting archived parents", async () => {
    const a = await setup(), id = await seed(a), other = await seedAccount(fixture.admin, a.user), category = await seedCategory(fixture.admin, a.user);
    await fixture.admin.query("update finance.accounts set archived_at=now() where user_id=$1", [a.user]);
    await fixture.admin.query("update finance.transaction_categories set archived_at=now() where user_id=$1", [a.user]);
    expect((await repository.update(a.user, id, { expectedVersion: 1, memo: "옛 기록", accountId: a.accountId, categoryId: a.categoryId })).version).toBe(2);
    await expect(repository.update(a.user, id, { expectedVersion: 2, accountId: other })).rejects.toMatchObject({ code: "LEDGER_ACCOUNT_UNAVAILABLE" });
    await expect(repository.update(a.user, id, { expectedVersion: 2, categoryId: category })).rejects.toMatchObject({ code: "LEDGER_CATEGORY_UNAVAILABLE" });
    expect((await repository.remove(a.user, id, { expectedVersion: 2 })).version).toBe(3);
  });
  it("serializes concurrent versions and preserves a soft-deleted tombstone without balance", async () => {
    const a = await setup(), id = await seed(a);
    const results = await Promise.allSettled([repository.update(a.user, id, { expectedVersion: 1, memo: "첫 요청" }), repository.update(a.user, id, { expectedVersion: 1, memo: "다른 요청" })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "LEDGER_VERSION_CONFLICT" } });
    await expect(repository.remove(a.user, id, { expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
    const tombstone = await repository.remove(a.user, id, { expectedVersion: 2 });
    expect(tombstone).toEqual({ id, version: 3, deletedAt: expect.any(String) });
    expect((await repository.list(a.user, {})).items).toEqual([]);
    expect((await new AccountsRepository(new UserDatabase(pool)).list(a.user, false)).items[0]?.currentBalanceKrw).toBe(0);
    expect((await fixture.admin.query("select count(*)::int n from finance.transaction_history where id=$1", [id])).rows[0].n).toBe(1);
    await expect(repository.remove(a.user, id, { expectedVersion: 2 })).rejects.toMatchObject({ status: 404 });
    await expect(repository.update(a.user, id, { expectedVersion: 3, memo: "부활" })).rejects.toMatchObject({ status: 404 });
  });
  it("rejects opening balance edits and deletion", async () => {
    const a = await setup();
    const result = await fixture.admin.query("insert into finance.transaction_history(user_id,account_id,kind,amount_krw,occurred_on,opening_direction) values($1,$2,'opening_balance',100,'2026-10-01','asset') returning id", [a.user, a.accountId]);
    const id = result.rows[0].id;
    await expect(repository.update(a.user, id, { expectedVersion: 1, memo: "x" })).rejects.toMatchObject({ code: "LEDGER_VALIDATION_FAILED" });
    await expect(repository.remove(a.user, id, { expectedVersion: 1 })).rejects.toMatchObject({ code: "LEDGER_VALIDATION_FAILED" });
  });
});
