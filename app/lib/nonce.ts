/**
 * Single-use challenges.
 *
 * A signature is only proof if it cannot be replayed, and the nonce is what makes it
 * single-use. Issued here, spent exactly once, and never accepted twice.
 *
 * Server-only.
 */

import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";

const TTL_MINUTES = 5;

export type NoncePurpose = "login" | "invite";

/** Issue a 32-byte challenge. 32 because that is what a NEP-413 payload requires. */
export async function issueNonce(
  purpose: NoncePurpose,
  subject?: string,
): Promise<{ nonce: string; bytes: Uint8Array }> {
  const bytes = randomBytes(32);
  const nonce = bytes.toString("hex");

  await query(
    `insert into auth_nonces (nonce, purpose, subject, expires_at)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [nonce, purpose, subject ?? null, String(TTL_MINUTES)],
  );

  return { nonce, bytes };
}

/**
 * Spend a nonce, or fail.
 *
 * The update is the check: `used_at is null` in the `where` clause means the database
 * decides, atomically, whether this is the first use. Reading then writing would leave a
 * window for two requests to both pass.
 */
export async function spendNonce(
  nonce: string,
  purpose: NoncePurpose,
): Promise<{ subject: string | null } | null> {
  const row = await queryOne<{ subject: string | null }>(
    `update auth_nonces
        set used_at = now()
      where nonce = $1
        and purpose = $2
        and used_at is null
        and expires_at > now()
      returning subject`,
    [nonce, purpose],
  );
  return row;
}

/** Housekeeping. Spent and expired nonces have no further use. */
export async function pruneNonces(): Promise<number> {
  const rows = await query<{ nonce: string }>(
    `delete from auth_nonces where expires_at < now() - interval '1 hour' returning nonce`,
  );
  return rows.length;
}
