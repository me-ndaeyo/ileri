/**
 * The database. One pool, created once, for the whole process.
 *
 * Server-only. Nothing here may be imported from a client component: the connection
 * string is a credential and a bundler that followed this import would ship it.
 *
 * The database holds no money and no invoice status. Losing it loses encrypted invoice
 * files and open payment quotes, never a balance or whether something was paid, because
 * the contract is the only source of truth for those.
 */

import { Pool } from "pg";

declare global {
  var ileriPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. See app/.env.example.");
  }

  return new Pool({
    connectionString,
    // Set explicitly rather than relying on `sslmode=require` in the URL. `pg` currently
    // treats that as full verification but is changing to libpq semantics, which are
    // weaker; stating it here means the posture cannot shift under us when pg updates.
    ssl: { rejectUnauthorized: true },
    // Each serverless invocation gets its own process, so a large pool per instance
    // multiplies into Neon's connection limit rather than helping.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * Reused across hot reloads in development, where each recompile would otherwise leak a
 * pool and exhaust the connection limit within a few edits.
 */
export const pool: Pool = global.ileriPool ?? createPool();
if (process.env.NODE_ENV !== "production") global.ileriPool = pool;

/** A parameterised query. Values are always bound, never interpolated. */
export async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, values);
  return result.rows as T[];
}

/** The single row a query must return, or `null`. */
export async function queryOne<T>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}
