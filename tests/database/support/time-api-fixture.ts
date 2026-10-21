import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { UserDatabase } from "../../../apps/api/src/core/user-database.js";
import { ProfilesRepository } from "../../../apps/api/src/profiles/profiles.repository.js";
import { TransactionsRepository } from "../../../apps/api/src/transactions/transactions.repository.js";
import { CORE_URL, openCoreDatabase } from "./core-database.js";

/** 고정 loopback 폐기 DB와 실제 app_api 역할 저장소를 준비한다. 운영 연결은 fixture가 거부한다. */
export async function timeApiFixture() {
  const fixture = await openCoreDatabase(), password = randomBytes(24).toString("hex");
  await fixture.admin.query("set statement_timeout='3s'; set lock_timeout='1s'");
  await fixture.admin.query(`create role time_api_runner login password '${password}' in role app_api`);
  const url = new URL(CORE_URL); url.username = "time_api_runner"; url.password = password;
  const pool = new Pool({ connectionString: url.href, max: 4 }), database = new UserDatabase(pool);
  return { admin: fixture.admin, profiles: new ProfilesRepository(database), transactions: new TransactionsRepository(database),
    close: async () => { await pool.end(); await fixture.admin.query("drop role time_api_runner"); await fixture.close(); } };
}
