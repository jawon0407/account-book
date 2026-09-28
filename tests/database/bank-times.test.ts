import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBankDatabase, type BankTestDatabase } from "./support/bank-database.js";
import { AT, ENVELOPE, seedConnection, seedCredentials } from "./support/bank-fixtures.js";

let database: BankTestDatabase;
beforeAll(async () => { database = await openBankDatabase(); });
afterAll(async () => { await database?.close(); });

describe("connection and credential temporal invariants", () => {
  it.each([
    ["created_at", "-infinity"], ["updated_at", "infinity"],
    ["updated_at", "2026-09-27T23:59:59Z"], ["consent_expires_at", "infinity"],
    ["consent_expires_at", "-infinity"],
  ])("rejects invalid connection %s=%s", async (column, value) => {
    const id = await seedConnection(database.admin);
    // column은 위의 고정 테스트 목록에서만 가져온다. 사용자 입력을 SQL 이름으로 넣지 않는다.
    await expect(database.admin.query(`update app_bank.bank_connections set ${column}=$1 where id=$2`, [value, id])).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    ["created_at", "-infinity"], ["updated_at", "infinity"],
    ["updated_at", "2026-09-27T23:59:59Z"], ["access_expires_at", "infinity"],
    ["access_expires_at", AT], ["access_expires_at", "2026-09-27T23:59:59Z"],
    ["refresh_expires_at", "infinity"], ["refresh_expires_at", AT],
    ["refresh_expires_at", "2026-09-28T01:00:00Z"],
  ])("rejects invalid credential %s=%s", async (column, value) => {
    const id = await seedConnection(database.admin);
    await seedCredentials(database.admin, id);
    await expect(database.admin.query(`update app_bank.bank_connection_credentials set ${column}=$1 where connection_id=$2`, [value, id])).rejects.toMatchObject({ code: "23514" });
  });

  it("allows finite consent and a refresh expiry only with a refresh envelope", async () => {
    const id = await seedConnection(database.admin);
    await seedCredentials(database.admin, id);
    await database.admin.query("update app_bank.bank_connections set consent_expires_at='2026-10-01T00:00:00Z' where id=$1", [id]);
    await database.admin.query("update app_bank.bank_connection_credentials set encrypted_refresh_token=$1,refresh_expires_at='2026-10-01T00:00:00Z' where connection_id=$2", [ENVELOPE, id]);
    await expect(database.admin.query("update app_bank.bank_connection_credentials set refresh_expires_at='-infinity' where connection_id=$1", [id])).rejects.toMatchObject({ code: "23514" });
  });
});
