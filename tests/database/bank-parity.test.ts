import { bankConnectionCredentials, bankConnectionRequests, bankConnections } from "@account-book/database";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBankDatabase, type BankTestDatabase } from "./support/bank-database.js";

let database: BankTestDatabase;
beforeAll(async () => { database = await openBankDatabase(); });
afterAll(async () => { await database?.close(); });

describe("Drizzle declarations versus live PostgreSQL catalog", () => {
  it.each([bankConnections, bankConnectionRequests, bankConnectionCredentials])("matches live columns and constraints for table %#", async (declaration) => {
    const config = getTableConfig(declaration);
    const name = `${config.schema}.${config.name}`;
    const columns = await database.admin.query(`select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,
      a.attnotnull as required, a.atthasdef as has_default
      from pg_attribute a where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`, [name]);
    expect(columns.rows).toEqual(config.columns.map((column) => ({ name: column.name, type: column.getSQLType(), required: column.notNull, has_default: column.hasDefault })));

    const constraints = await database.admin.query(`select conname as name,contype as type,
      array(select a.attname::text from unnest(c.conkey) with ordinality as k(num,pos)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num order by k.pos) as columns,
      array(select a.attname::text from unnest(c.confkey) with ordinality as k(num,pos)
        join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.num order by k.pos) as foreign_columns
      from pg_constraint c where c.conrelid=$1::regclass order by conname`, [name]);
    const checkNames = constraints.rows.filter((row) => row.type === "c").map((row) => row.name).sort();
    expect(checkNames).toEqual(config.checks.map((check) => check.name).sort());
    const uniqueNames = constraints.rows.filter((row) => row.type === "u").map((row) => row.name).sort();
    expect(uniqueNames).toEqual([
      ...config.uniqueConstraints.map((unique) => unique.getName()),
      ...config.columns.filter((column) => column.isUnique).map((column) => column.uniqueName),
    ].sort());
    expect(constraints.rows.filter((row) => row.type === "p").map((row) => row.columns)).toEqual([config.columns.filter((column) => column.primary).map((column) => column.name)]);
    expect(constraints.rows.filter((row) => row.type === "f").map((row) => ({ name: row.name, columns: row.columns, foreign_columns: row.foreign_columns }))).toEqual(config.foreignKeys.map((key) => ({ name: key.getName(), columns: key.reference().columns.map((column) => column.name), foreign_columns: key.reference().foreignColumns.map((column) => column.name) })));
    const indexes = await database.admin.query(`select ci.relname as name,i.indisunique as unique,
      array(select a.attname::text from unnest(i.indkey) with ordinality as k(num,pos)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num order by k.pos) as columns
      from pg_index i join pg_class ci on ci.oid=i.indexrelid
      where i.indrelid=$1::regclass and i.indpred is not null`, [name]);
    expect(indexes.rows).toEqual(config.indexes.map((index) => ({ name: index.config.name, unique: index.config.unique, columns: index.config.columns.flatMap((column) => "name" in column ? [column.name] : []) })));
    if (config.name === "bank_connection_requests") {
      const expression = (await database.admin.query("select pg_get_indexdef('app_bank.bank_requests_pending_deadline_idx'::regclass,1,true) as expression")).rows[0].expression;
      expect(expression.toLowerCase().replaceAll(" ", "")).toBe("least(expires_at,code_expires_at)");
    }
  });
});
