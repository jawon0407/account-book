import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/auth.js";

/**
 * Creates a database client for the supplied PostgreSQL connection string.
 * The connection string is validated but never logged.
 *
 * @param connectionString PostgreSQL connection string for this client instance.
 */
export function createDatabaseClient(connectionString: string) {
  if (!connectionString.trim()) throw new Error("connectionString must not be blank");
  return drizzle({ connection: connectionString, schema });
}
