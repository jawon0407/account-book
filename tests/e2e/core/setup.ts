import { readFile } from "node:fs/promises";
import { openCoreDatabase } from "../../database/support/core-database.js";

/** @param bank 은행 통합 검증용 migration과 BFF 최소권한 계정을 추가할지 여부. 폐기용 DB만 생성한다. */
export default async function setup(bank = false) {
  const database = await openCoreDatabase();
  try {
    for (const name of ["202607200002_server_pkce_transactions.sql", "202607200003_user_security_state.sql", "20261016040532_native_session_channel.sql", "20261016044255_native_auth_rate_limits.sql", "20261016053724_collector_lease.sql"]) {
      await database.admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    // 실제 이메일 gate를 우회하지 않고 폐기용 Auth 테이블에 합성 이메일과 신규 migration을 준비한다.
    await database.admin.query("alter table auth.users add column email text");
    for (const name of ["202610010001_auth_account_lookup.sql", "202610010002_oauth_signup_intent.sql"]) {
      await database.admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    await database.admin.query("alter role app_api login password 'account-book-e2e-only'");
    if (bank) {
      await database.admin.query("alter role app_session_bff login password 'account-book-e2e-only'");
      for (const name of ["202609280001_bank_connection_storage.sql", "202609280002_bank_connection_access.sql", "202610010003_bank_request_intake.sql", "202610010004_bank_request_exchange.sql", "202610010005_bank_request_end.sql", "202610020001_bank_request_limits.sql", "202610020002_bank_request_cleanup.sql"]) {
        await database.admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
      }
    }
    await database.admin.query("insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)", ["123e4567-e89b-42d3-a456-426614174001", "verified@example.test", '{"provider":"email"}']);
    await database.admin.query("insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)", ["123e4567-e89b-42d3-a456-426614174003", "second@example.test", '{"provider":"email"}']);
    return () => database.close();
  } catch (error) { await database.close(); throw error; }
}
