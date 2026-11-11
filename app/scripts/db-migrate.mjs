#!/usr/bin/env node
//
// Apply lib/schema.sql.
//
// The schema is written to be idempotent — every statement is `if not exists` — so this
// is safe to re-run and needs no migration table for a project this size. When a change
// genuinely needs ordering, that is the point to add real migrations rather than now.

import { readFileSync } from "node:fs";
import { Client } from "pg";

try {
  const file = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of file.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // Fall through to the missing-variable message below.
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. See app/.env.example.");
  process.exit(1);
}

const schema = readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

try {
  await client.connect();
  // One transaction: a half-applied schema is worse than none.
  await client.query("begin");
  await client.query(schema);
  await client.query("commit");

  const { rows } = await client.query(
    `select table_name,
            (select count(*) from information_schema.columns c
              where c.table_name = t.table_name) as columns
       from information_schema.tables t
      where table_schema = 'public'
      order by table_name`,
  );
  console.log("applied:\n");
  for (const row of rows) console.log(`  ${row.table_name.padEnd(16)} ${row.columns} columns`);
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(`failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
