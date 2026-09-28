import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

const exports: Record<string, unknown> = await import("../index.js");

describe("bank database query declarations", () => {
  it.each([
    ["bankConnections", "bank_connections", ["id", "user_id", "provider", "environment", "status", "created_at", "updated_at", "consent_expires_at"]],
    ["bankConnectionRequests", "bank_connection_requests", ["id", "user_id", "session_id", "provider", "environment", "channel", "state_digest", "proof_digest", "status", "created_at", "expires_at", "callback_received_at", "code_expires_at", "encrypted_code", "connection_id"]],
    ["bankConnectionCredentials", "bank_connection_credentials", ["connection_id", "user_id", "provider", "environment", "encrypted_provider_subject", "encrypted_access_token", "encrypted_refresh_token", "access_expires_at", "refresh_expires_at", "created_at", "updated_at"]],
  ] as const)("makes %s queries target the correct private columns", (name, tableName, columns) => {
    expect(exports[name]).toBeDefined();
    const table = getTableConfig(exports[name] as PgTable);
    expect(table.schema).toBe("app_bank");
    expect(table.name).toBe(tableName);
    expect(table.columns.map((column) => column.name)).toEqual(columns);
    expect(table.enableRLS).toBe(true);
  });

  it("declares ownership in both composite references instead of referencing an ID alone", () => {
    for (const name of ["bankConnectionRequests", "bankConnectionCredentials"]) {
      expect(exports[name]).toBeDefined();
      const table = getTableConfig(exports[name] as PgTable);
      expect(table.foreignKeys).toHaveLength(1);
      const reference = table.foreignKeys[0].reference();
      expect(reference.columns.map((column) => column.name)).toEqual(["connection_id", "user_id", "provider", "environment"]);
      expect(reference.foreignColumns.map((column) => column.name)).toEqual(["id", "user_id", "provider", "environment"]);
    }
  });
});
