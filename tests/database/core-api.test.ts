import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountSchema } from "../../packages/contracts/src/accounts.js";
import { UserDatabase } from "../../apps/api/src/core/user-database.js";
import { idempotentCreate } from "../../apps/api/src/core/idempotency.js";
import { ProfilesRepository } from "../../apps/api/src/profiles/profiles.repository.js";
import { AccountsRepository } from "../../apps/api/src/accounts/accounts.repository.js";
import { CategoriesRepository } from "../../apps/api/src/categories/categories.repository.js";
import { CORE_URL, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedCategory, seedUser } from "./support/core-fixtures.js";

describe("core API repositories with real least-privilege PostgreSQL", () => {
  let fixture: CoreDatabase, pool: Pool, db: UserDatabase;
  let profiles: ProfilesRepository, accounts: AccountsRepository, categories: CategoriesRepository;
  beforeAll(async () => {
    fixture = await openCoreDatabase();
    const password = randomBytes(24).toString("hex");
    // 비밀번호는 폐기용 로컬 테스트 역할에만 사용하며 출력/저장하지 않는다.
    await fixture.admin.query(`create role core_api_runner login password '${password}' in role app_api`);
    const url = new URL(CORE_URL); url.username = "core_api_runner"; url.password = password;
    pool = new Pool({ connectionString: url.href, max: 4 });
    db = new UserDatabase(pool); profiles = new ProfilesRepository(db);
    accounts = new AccountsRepository(db); categories = new CategoriesRepository(db);
  });
  afterAll(async () => { await pool?.end(); if (fixture) { await fixture.admin.query("drop role core_api_runner"); await fixture.close(); } });

  it("loads a real member profile and rejects stale nickname edits", async () => {
    const user = await seedUser(fixture.admin);
    expect(await profiles.get(user)).toMatchObject({ id: user, nickname: null, role: "member", signupProvider: "email", version: 1 });
    expect(await profiles.update(user, { nickname: "새 이름", expectedVersion: 1 })).toMatchObject({ nickname: "새 이름", version: 2 });
    await expect(profiles.update(user, { nickname: "old", expectedVersion: 1 })).rejects.toMatchObject({ code: "PROFILE_VERSION_CONFLICT" });
  });
  it("denies missing and deleted principals rather than returning an empty ledger", async () => {
    const user = await seedUser(fixture.admin);
    await fixture.admin.query("update \"user\".users set deleted_at=now() where user_id=$1", [user]);
    for (const id of [user, randomUUID()]) await expect(accounts.list(id, false)).rejects.toMatchObject({ status: 401 });
  });
  it("creates once across concurrent same-key requests and replays the first snapshot", async () => {
    const user = await seedUser(fixture.admin), key = randomUUID();
    const input = { kind: "bank" as const, name: "통장", idempotencyKey: key };
    const [first, second] = await Promise.all([accounts.create(user, input), accounts.create(user, { ...input, idempotencyKey: key.toUpperCase() })]);
    expect(second).toEqual(first);
    expect((await accounts.list(user, false)).items).toHaveLength(1);
    await accounts.update(user, first.id, { name: "새 통장", expectedVersion: 1 });
    expect(await accounts.create(user, input)).toEqual(first);
    await expect(accounts.create(user, { ...input, name: "다른 내용" })).rejects.toMatchObject({ code: "LEDGER_IDEMPOTENCY_CONFLICT" });
  });
  it("isolates idempotency by user and operation and leaves no context in the pool", async () => {
    const a = await seedUser(fixture.admin), b = await seedUser(fixture.admin), key = randomUUID();
    const one = await accounts.create(a, { kind: "cash", name: "A", idempotencyKey: key });
    const two = await accounts.create(b, { kind: "cash", name: "B", idempotencyKey: key });
    const category = await categories.create(a, { kind: "expense", name: "식비", sortOrder: 0, idempotencyKey: key });
    expect(new Set([one.id, two.id, category.id]).size).toBe(3);
    for (let n = 0; n < 4; n++) {
      expect((await accounts.list(a, false)).items.map(item => item.name)).toEqual(["A"]);
      expect((await accounts.list(b, false)).items.map(item => item.name)).toEqual(["B"]);
    }
    expect((await pool.query("select count(*)::int as n from finance.accounts")).rows[0].n).toBe(0);
  });
  it("never exposes another user's account and allows only one competing version update", async () => {
    const a = await seedUser(fixture.admin), b = await seedUser(fixture.admin);
    const row = await accounts.create(a, { kind: "bank", name: "내 계좌", idempotencyKey: randomUUID() });
    await expect(accounts.update(b, row.id, { name: "공격", expectedVersion: 1 })).rejects.toMatchObject({ status: 404 });
    const results = await Promise.allSettled(["one", "two"].map(name => accounts.update(a, row.id, { name, expectedVersion: 1 })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "LEDGER_VERSION_CONFLICT" } });
    const archived = await accounts.archive(a, row.id, { expectedVersion: 2 });
    expect(archived.archivedAt).not.toBeNull();
    expect((await accounts.list(a, false)).items).toHaveLength(0);
    expect((await accounts.list(a, true)).items).toHaveLength(1);
    await expect(accounts.update(a, row.id, { name: "retry", expectedVersion: 3 })).rejects.toMatchObject({ code: "LEDGER_ACCOUNT_UNAVAILABLE" });
  });
  it("sorts categories, permits zero sortOrder, rejects stale edits and archives without deletion", async () => {
    const user = await seedUser(fixture.admin);
    const input = { kind: "expense" as const, name: "식비", sortOrder: 5, idempotencyKey: randomUUID() };
    const row = await categories.create(user, input);
    expect(await categories.create(user, input)).toEqual(row);
    const updated = await categories.update(user, row.id, { sortOrder: 0, expectedVersion: 1 });
    expect(updated).toMatchObject({ sortOrder: 0, version: 2, kind: "expense" });
    await expect(categories.update(user, row.id, { name: "old", expectedVersion: 1 })).rejects.toMatchObject({ code: "LEDGER_VERSION_CONFLICT" });
    await categories.archive(user, row.id, { expectedVersion: 2 });
    expect((await categories.list(user, false)).items).toEqual([]);
    expect((await categories.list(user, true)).items).toHaveLength(1);
    await expect(categories.update(user, row.id, { name: "new", expectedVersion: 3 })).rejects.toMatchObject({ code: "LEDGER_CATEGORY_UNAVAILABLE" });
  });
  it("rolls back both newly created data and idempotency when work fails", async () => {
    const user = await seedUser(fixture.admin), key = randomUUID();
    await expect(db.run(user, client => idempotentCreate(client, user, "create_account", key, { kind: "cash", name: "실패" }, AccountSchema, async () => {
      await client.query("insert into finance.accounts(user_id,kind,name) values($1,'cash','실패')", [user]);
      throw new Error("private SQL and credential");
    }))).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
    expect((await accounts.list(user, false)).items).toEqual([]);
    expect((await fixture.admin.query("select count(*)::int as n from finance.request_deduplication where user_id=$1", [user])).rows[0].n).toBe(0);
  });
  it("sums signed opening/income/expense while excluding tombstones and rejects overflow", async () => {
    const user = await seedUser(fixture.admin);
    const row = await accounts.create(user, { kind: "bank", name: "합계", idempotencyKey: randomUUID() });
    const income = await seedCategory(fixture.admin, user, "income"), expense = await seedCategory(fixture.admin, user);
    await fixture.admin.query("insert into finance.transaction_history(user_id,account_id,kind,amount_krw,occurred_on,opening_direction) values($1,$2,'opening_balance',10000,'2026-09-29','liability')", [user, row.id]);
    await fixture.admin.query("insert into finance.transaction_history(user_id,account_id,kind,amount_krw,occurred_on,category_id) values($1,$2,'income',7000,'2026-09-29',$3),($1,$2,'expense',1500,'2026-09-29',$4)", [user, row.id, income, expense]);
    await fixture.admin.query("insert into finance.transaction_history(user_id,account_id,kind,amount_krw,occurred_on,category_id,deleted_at) values($1,$2,'expense',1000,'2026-09-29',$3,now())", [user, row.id, expense]);
    expect((await accounts.list(user, false)).items[0]?.currentBalanceKrw).toBe(-4500);
    await fixture.admin.query("insert into finance.transaction_history(user_id,account_id,kind,amount_krw,occurred_on,category_id) values($1,$2,'expense',9007199254740991,'2026-09-29',$3)", [user, row.id, expense]);
    await expect(accounts.list(user, false)).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
  });
  it("counts an internal transfer once per account without changing total assets", async () => {
    const user = await seedUser(fixture.admin);
    const a = await accounts.create(user, { kind: "bank", name: "A", idempotencyKey: randomUUID() });
    const b = await accounts.create(user, { kind: "cash", name: "B", idempotencyKey: randomUUID() });
    await fixture.admin.query("begin");
    try {
      await fixture.admin.query("insert into finance.transaction_history(user_id,account_id,kind,amount_krw,occurred_on,opening_direction) values($1,$2,'opening_balance',10000,'2026-09-29','asset')", [user, a.id]);
      const transfer = await fixture.admin.query("insert into finance.account_transfers(user_id,from_account_id,to_account_id,amount_krw,occurred_on) values($1,$2,$3,3000,'2026-09-29') returning id", [user, a.id, b.id]);
      await fixture.admin.query("insert into finance.transaction_history(user_id,account_id,kind,amount_krw,occurred_on,transfer_id) values($1,$2,'transfer_out',3000,'2026-09-29',$4),($1,$3,'transfer_in',3000,'2026-09-29',$4)", [user, a.id, b.id, transfer.rows[0].id]);
      await fixture.admin.query("commit");
    } catch (error) { await fixture.admin.query("rollback"); throw error; }
    expect((await accounts.list(user, false)).items.map(row => [row.name, row.currentBalanceKrw])).toEqual([["A", 7000], ["B", 3000]]);
  });
  it("validates category key conflicts and ownership independently from account access", async () => {
    const a = await seedUser(fixture.admin), b = await seedUser(fixture.admin);
    const value = { kind: "income" as const, name: "급여", sortOrder: 10, idempotencyKey: randomUUID() };
    const row = await categories.create(a, value);
    await expect(categories.create(a, { ...value, kind: "expense" })).rejects.toMatchObject({ code: "LEDGER_IDEMPOTENCY_CONFLICT" });
    await expect(categories.archive(b, row.id, { expectedVersion: 1 })).rejects.toMatchObject({ status: 404 });
    await categories.create(a, { kind: "expense", name: "교통", sortOrder: 0, idempotencyKey: randomUUID() });
    expect((await categories.list(a, false)).items.map(item => item.name)).toEqual(["교통", "급여"]);
  });
  it("bounds lock waits without writing a partial account and allows a later retry", async () => {
    const user = await seedUser(fixture.admin), key = randomUUID(), blocker = await pool.connect();
    const value = { kind: "cash" as const, name: "대기", idempotencyKey: key };
    try {
      await blocker.query("begin");
      await blocker.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${user}:create_account:${key}`]);
      await expect(accounts.create(user, value)).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE", retryable: true });
      expect((await accounts.list(user, false)).items).toEqual([]);
    } finally { await blocker.query("rollback"); blocker.release(); }
    expect(await accounts.create(user, value)).toMatchObject({ name: "대기", version: 1 });
  });
  it("fails closed on malformed stored snapshots and does not silently truncate large lists", async () => {
    const user = await seedUser(fixture.admin), key = randomUUID();
    const value = { kind: "cash" as const, name: "원본", idempotencyKey: key };
    await accounts.create(user, value);
    await fixture.admin.query("update finance.request_deduplication set response_snapshot='{}' where user_id=$1 and idempotency_key=$2", [user, key]);
    await expect(accounts.create(user, value)).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
    await fixture.admin.query("insert into finance.accounts(user_id,kind,name) select $1,'cash','추가 '||n from generate_series(1,1000) n", [user]);
    await expect(accounts.list(user, true)).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
  });
});
