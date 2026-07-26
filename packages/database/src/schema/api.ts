import { sql } from "drizzle-orm/sql";
import { check, customType, pgSchema, timestamp } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const appPrivate = pgSchema("app_private");

/**
 * Stores only one-way delegated-JWT identifier digests until their expiry.
 * The primary key makes consumption atomic, while exact-length and future-expiry
 * checks reject values that cannot represent the verifier's SHA-256 replay key.
 */
export const apiJwtReplays = appPrivate.table(
  "api_jwt_replays",
  {
    jtiDigest: bytea("jti_digest").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("api_jwt_replays_digest_length", sql`octet_length(${table.jtiDigest}) = 32`),
    check("api_jwt_replays_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
