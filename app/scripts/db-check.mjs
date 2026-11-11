#!/usr/bin/env node
//
// Does the database actually work?
//
// Neon's onboarding has a button that claims your app is connected. This asks the
// database instead: it connects, queries, and proves it can write. The connection string
// is read from the environment and never printed, so running this cannot leak it into a
// terminal log or a CI transcript.

import { readFileSync } from "node:fs";
import { Client } from "pg";

// Next loads .env.local automatically; a standalone script does not.
try {
  const file = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of file.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // No .env.local yet. The check below prints the useful message.
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to app/.env.local:\n");
  console.error("  DATABASE_URL=postgresql://...\n");
  process.exit(1);
}

// Report the shape without the secret, so a failure stays debuggable without exposure.
let host;
try {
  const parsed = new URL(url);
  host = parsed.host;
  console.log(`host     ${host}`);
  console.log(`database ${parsed.pathname.slice(1)}`);
  console.log(`pooled   ${host.includes("-pooler") ? "yes" : "no"}`);
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}

const client = new Client({ connectionString: url });
try {
  await client.connect();
  const { rows } = await client.query("select version(), now()");
  console.log(`\nconnected`);
  console.log(`server   ${rows[0].version.split(" ").slice(0, 2).join(" ")}`);
  console.log(`time     ${rows[0].now.toISOString()}`);

  // Reading proves nothing about writing, and the app needs to write. Prove it.
  await client.query("create table if not exists ileri_connectivity_check (ok boolean)");
  await client.query("drop table ileri_connectivity_check");
  console.log(`writable yes`);

  if (!host.includes("-pooler")) {
    console.log(
      `\nNote: this is the direct endpoint. Use the pooled one, whose host contains` +
        ` "-pooler", or serverless functions will exhaust the connection limit.`,
    );
  }
} catch (error) {
  console.error(`\nfailed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
