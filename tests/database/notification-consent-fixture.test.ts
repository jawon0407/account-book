import { Client } from "pg";
import { expect, it } from "vitest";
import { openNotificationConsentDatabase } from "./support/notification-consent-fixtures.js";

it("preserves pre-existing local runtime role login configuration", async () => {
  if (process.env.TEST_DATABASE_URL !== "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test" || process.env.TEST_DATABASE_DISPOSABLE !== "true") throw new Error("TEST_DATABASE_CONFIGURATION_INVALID");
  const control = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await control.connect(); let db: Awaited<ReturnType<typeof openNotificationConsentDatabase>> | undefined;
  const original = (await control.query("select rolcanlogin from pg_roles where rolname='app_session_bff'")).rows[0];
  try {
    // 실제 화면 테스트 환경처럼 이미 LOGIN 가능한 역할을 만든 경우를 재현한다.
    if (original) await control.query("alter role app_session_bff login");
    db = await openNotificationConsentDatabase();
    if (original) expect((await control.query("select rolcanlogin from pg_roles where rolname='app_session_bff'")).rows[0].rolcanlogin).toBe(true);
  } finally {
    await db?.close();
    if (original) await control.query(original.rolcanlogin ? "alter role app_session_bff login" : "alter role app_session_bff nologin");
    await control.end();
  }
});
