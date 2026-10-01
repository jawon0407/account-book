import * as databaseExports from "@account-book/database";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCoreDatabase, type CoreDatabase } from "./support/core-database.js";

let db: CoreDatabase;
beforeAll(async () => { db = await openCoreDatabase(); });
afterAll(async () => { await db?.close(); });

describe("core SQL and Drizzle declaration parity", () => {
  it.each(["profiles", "userRoles", "roleChangeEvents", "ledgerAccounts", "ledgerCategories", "ledgerTransfers", "ledgerTransactions", "ledgerIdempotencyRequests"])("matches live columns and constraints for %s", async name => {
    const table = (databaseExports as unknown as Record<string, PgTable>)[name];
    expect(table, `missing declaration ${name}`).toBeDefined();
    const config = getTableConfig(table!);
    const relation = `${config.schema}.${config.name}`;
    const r = await db.admin.query(`select attname as name,format_type(atttypid,atttypmod) as type,attnotnull as required,atthasdef as has_default
      from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped order by attnum`, [relation]);
    expect(r.rows).toEqual(config.columns.map(c => ({ name: c.name, type: c.getSQLType(), required: c.notNull, has_default: c.hasDefault })));
    const constraints = (await db.admin.query(`select conname as name,contype as type,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(num,pos) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num order by k.pos) as columns
      from pg_constraint c where conrelid=$1::regclass order by conname`, [relation])).rows;
    expect(constraints.filter(r => r.type === "c").map(r => r.name)).toEqual(config.checks.map(c => c.name).sort());
    expect(constraints.filter(r => r.type === "u").map(r => r.name)).toEqual(config.uniqueConstraints.map(c => c.getName()).sort());
    expect(constraints.filter(r => r.type === "f").map(r => r.name)).toEqual(config.foreignKeys.map(c => c.getName()).sort());
    const primary = config.primaryKeys.length ? config.primaryKeys[0]!.columns : config.columns.filter(c => c.primary);
    expect(constraints.filter(r => r.type === "p").map(r => r.columns)).toEqual([primary.map(c => c.name)]);
    const indexes = (await db.admin.query(`select ci.relname as name,i.indisunique as unique,i.indpred is not null as partial
      from pg_index i join pg_class ci on ci.oid=i.indexrelid where i.indrelid=$1::regclass
      and not exists(select 1 from pg_constraint where conindid=i.indexrelid) order by ci.relname`, [relation])).rows;
    expect(indexes).toEqual(config.indexes.map(i => ({ name: i.config.name, unique: i.config.unique, partial: !!i.config.where })).sort((a,b) => a.name!.localeCompare(b.name!)));
    expect(config.enableRLS).toBe(true);
  });
});
