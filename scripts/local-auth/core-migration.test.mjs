import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { assertCorePreflight, assertCoreAccess, checkedSql, coreCommand } from "./core-migration.mjs";

const state = {
  currentUser: "postgres", database: "postgres", clientTls: true, databaseTls: true,
  schemas: [], authReady: true, privateTables: 7, bootstrapExists: false,
  rolesSafe: true, rolesPresent: true,
};
test("accepts only the approved three commands", () => {
  for (const command of ["--inspect", "--check", "--apply"]) assert.equal(coreCommand([command]), command);
  for (const args of [[], ["--force"], ["--apply", "--force"]]) assert.throws(() => coreCommand(args), /CORE_ARGUMENTS_INVALID/);
});
test("refuses existing schemas and unsafe or incomplete development state", () => {
  assert.doesNotThrow(() => assertCorePreflight(state));
  for (const mutation of [
    { currentUser: "app_api" }, { database: "other" }, { clientTls: false }, { databaseTls: false },
    { schemas: ["app_identity"] }, { schemas: ["app_ledger"] }, { authReady: false },
    { privateTables: 6 }, { bootstrapExists: true }, { rolesSafe: false }, { rolesPresent: false },
  ]) assert.throws(() => assertCorePreflight({ ...state, ...mutation }), /^Error: CORE_PREFLIGHT_REFUSED$/);
});
test("pins exact SQL bytes and refuses missing or modified content", () => {
  const sql = "select 1;\n", hash = createHash("sha256").update(sql).digest("hex");
  assert.equal(checkedSql(sql, hash), sql);
  for (const text of ["", "select 2;\n", sql + "commit;\n"]) assert.throws(() => checkedSql(text, hash), /CORE_SQL_CHECKSUM_MISMATCH/);
});
test("refuses overprivileged API grants without requiring owner role impersonation", () => {
  const access = { profileRead: true, nicknameUpdate: true, roleRead: true, providerUpdate: false, deletionUpdate: false, roleUpdate: false, auditRead: false, ledgerRead: true, ledgerDelete: false, transferUpdate: false };
  assert.doesNotThrow(() => assertCoreAccess(access));
  for (const key of Object.keys(access)) assert.throws(() => assertCoreAccess({ ...access, [key]: !access[key] }), /CORE_RUNTIME_GRANTS_INVALID/);
});
