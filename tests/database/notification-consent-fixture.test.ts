import { Client } from "pg";
import { expect, it } from "vitest";
import { openNotificationConsentDatabase } from "./support/notification-consent-fixtures.js";

it("preserves pre-existing local runtime role login configuration", async () => {
  if (process.env.TEST_DATABASE_URL !== "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test" || process.env.TEST_DATABASE_DISPOSABLE !== "true") throw new Error("TEST_DATABASE_CONFIGURATION_INVALID");
  const control = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await control.connect(); let db: Awaited<ReturnType<typeof openNotificationConsentDatabase>> | undefined;
  try {
    const query = "select rolname,rolcanlogin from pg_roles where rolname in ('app_session_bff','app_api') order by rolname";
    const original = (await control.query(query)).rows;
    // 기존 역할을 바꾸어 테스트 조건을 만들지 않는다. 실제 LOGIN/NOLOGIN 상태를 그대로 비교한다.
    db = await openNotificationConsentDatabase();
    expect((await control.query(query)).rows).toEqual(expect.arrayContaining(original));
    await db.close(); db = undefined;
    expect((await control.query(query)).rows).toEqual(expect.arrayContaining(original));
  } finally {
    // fixture 정리 실패도 별도 제어 연결의 종료를 막지 못하게 한다.
    try { await db?.close(); } finally { await control.end(); }
  }
});
