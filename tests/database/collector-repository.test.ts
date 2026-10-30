import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CollectorRepository } from "../../apps/api/src/collector/collector.repository.js";
import { UserDatabase } from "../../apps/api/src/core/user-database.js";
import { CORE_URL, type CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";
import { openCollectorDatabase, seedCollectorSession } from "./support/collector-fixtures.js";

describe("collector repository with actual least-privilege DB", () => {
  let fixture: CoreDatabase, pool: Pool, repository: CollectorRepository;
  beforeAll(async () => {
    fixture = await openCollectorDatabase();
    const password = randomBytes(24).toString("hex");
    await fixture.admin.query(`create role collector_http_test login password '${password}' in role app_api`);
    const url = new URL(CORE_URL); url.username = "collector_http_test"; url.password = password;
    pool = new Pool({ connectionString: url.href, max: 2 }); repository = new CollectorRepository(new UserDatabase(pool));
  });
  afterAll(async () => { await pool?.end(); if (fixture) { await fixture.admin.query("drop role collector_http_test"); await fixture.close(); } });
  it("observes CAS, explicit replacement and account isolation through the repository", async () => {
    const user = await seedUser(fixture.admin), other = await seedUser(fixture.admin);
    const a = await seedCollectorSession(fixture.admin, user), b = await seedCollectorSession(fixture.admin, user), foreign = await seedCollectorSession(fixture.admin, other);
    expect(await repository.get(user, a)).toEqual({ version: 0, state: "inactive" });
    expect(await repository.change(user, a, { action: "activate", expectedVersion: 0, replaceExisting: false })).toEqual({ version: 1, state: "active_here" });
    expect(await repository.get(user, b)).toEqual({ version: 1, state: "active_elsewhere" });
    await expect(repository.change(user, b, { action: "activate", expectedVersion: 1, replaceExisting: false })).rejects.toMatchObject({ code: "COLLECTOR_REPLACE_REQUIRED", status: 409 });
    expect(await repository.change(user, b, { action: "activate", expectedVersion: 1, replaceExisting: true })).toEqual({ version: 2, state: "active_here" });
    await expect(repository.change(user, a, { action: "deactivate", expectedVersion: 1 })).rejects.toMatchObject({ code: "COLLECTOR_VERSION_CONFLICT" });
    await expect(repository.get(user, foreign)).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(await repository.get(other, foreign)).toEqual({ version: 0, state: "inactive" });
    expect(await repository.change(user, a, { action: "deactivate", expectedVersion: 2 })).toEqual({ version: 3, state: "inactive" });
  });
  it("does not revive revoked sessions, and masks an inaccessible DB function", async () => {
    const user = await seedUser(fixture.admin), sid = await seedCollectorSession(fixture.admin, user);
    await fixture.admin.query("update app_private.auth_sessions set revoked_at=now() where id=$1", [sid]);
    await expect(repository.get(user, sid)).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED", status: 401 });
    const valid = await seedCollectorSession(fixture.admin, user);
    await fixture.admin.query("revoke execute on function app_private.collector_status(uuid) from app_api");
    try { await expect(repository.get(user, valid)).rejects.toMatchObject({ code: "COLLECTOR_SERVICE_UNAVAILABLE", status: 503, retryable: true }); }
    finally { await fixture.admin.query("grant execute on function app_private.collector_status(uuid) to app_api"); }
  });
});
