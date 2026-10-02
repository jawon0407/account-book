import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asCoreRole, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";

let database: CoreDatabase;
const legacyId = randomUUID();
beforeAll(async () => {
  database = await openCoreDatabase();
  await database.admin.query("insert into app_private.oauth_transactions(id,state_hash,interaction_hash,provider,encrypted_pkce_verifier,return_path,created_at,expires_at) values($1,$2,$3,'google','{}','/app',now(),now()+interval '10 minutes')", [legacyId, randomBytes(32), randomBytes(32)]);
  await database.admin.query(await readFile(new URL("../../supabase/migrations/202610010002_oauth_signup_intent.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await database?.close(); });

describe("persisted OAuth signup intent migration", () => {
  it("keeps an in-flight pre-migration transaction on the login path", async () => {
    expect((await database.admin.query("select intent from app_private.oauth_transactions where id=$1", [legacyId])).rows).toEqual([{ intent: "sign_in" }]);
  });

  it.each(["sign_in", "sign_up"])("lets only the BFF persist and read %s intent", async (intent) => {
    await asCoreRole(database.admin, "app_session_bff", undefined, async () => {
      const result = await database.admin.query("insert into app_private.oauth_transactions(id,state_hash,interaction_hash,provider,intent,encrypted_pkce_verifier,return_path,created_at,expires_at) values($1,$2,$3,'google',$4,'{}','/app',now(),now()+interval '10 minutes') returning intent", [randomUUID(), randomBytes(32), randomBytes(32), intent]);
      expect(result.rows).toEqual([{ intent }]);
    });
  });

  it.each([[null, "23502"], ["admin", "23514"]])("rejects invalid persisted intent %#", async (intent, code) => {
    await asCoreRole(database.admin, "app_session_bff", undefined, async () => {
      await expect(database.admin.query("update app_private.oauth_transactions set intent=$1 where id=$2", [intent, legacyId])).rejects.toMatchObject({ code });
    });
  });

  it.each(["anon", "authenticated", "service_role", "app_api"] as const)("keeps %s outside the intent storage boundary", async (role) => {
    await asCoreRole(database.admin, role, undefined, async () => {
      await expect(database.admin.query("select intent from app_private.oauth_transactions")).rejects.toMatchObject({ code: "42501" });
    });
  });
});
