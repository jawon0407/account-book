import { readFile } from "node:fs/promises";
import { openCoreDatabase } from "../../database/support/core-database.js";

/** 폐기용 loopback DB만 생성한다. 기존 DB를 덮어쓰지 않고 테스트 끝에 이번 DB만 정리한다. */
export default async function setup() {
  const database = await openCoreDatabase();
  try {
    for (const name of ["202607200002_server_pkce_transactions.sql", "202607200003_user_security_state.sql"]) {
      await database.admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    // 실제 이메일 gate를 우회하지 않고 폐기용 Auth 테이블에 합성 이메일과 신규 migration을 준비한다.
    await database.admin.query("alter table auth.users add column email text");
    for (const name of ["202610010001_auth_account_lookup.sql", "202610010002_oauth_signup_intent.sql"]) {
      await database.admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    await database.admin.query("alter role app_api login password 'account-book-e2e-only'");
    await database.admin.query("insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)", ["123e4567-e89b-42d3-a456-426614174001", "verified@example.test", '{"provider":"email"}']);
    return () => database.close();
  } catch (error) { await database.close(); throw error; }
}
