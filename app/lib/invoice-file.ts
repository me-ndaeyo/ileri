/**
 * Reading the offchain invoice document, and deciding who may.
 *
 * Shared by the file route and by the pages that render a document, so the access rule
 * has exactly one implementation. A page that fetched its own API over HTTP would be
 * slower and, worse, would invite the rule drifting between the two.
 *
 * Server-only.
 */

import { open, sha256 } from "./crypto";
import { queryOne } from "./db";
import type { InvoiceView } from "./near";

export type FileDenial = "not-allowed" | "no-document" | "hash-mismatch";

/**
 * May this viewer read this invoice's document?
 *
 * Decided against the invoice as the chain currently reports it, never from a session
 * alone. Checking the holder live is what makes a sale take effect at once: the moment an
 * invoice changes hands the previous holder stops being able to read it, without waiting
 * for a session or a token to expire.
 */
export function mayReadDocument(
  invoice: InvoiceView,
  accountId: string | null,
  inviteForInvoiceId: string | null,
): boolean {
  if (inviteForInvoiceId === invoice.id) return true;
  if (!accountId) return false;
  return (
    accountId === invoice.issuer ||
    accountId === invoice.client ||
    accountId === invoice.holder
  );
}

/**
 * Decrypt the stored document, checking it still matches the chain.
 *
 * The hash check is not a formality. If the stored row has drifted from what the invoice
 * was minted for, serving it would present something nobody agreed to as genuine, so it
 * is refused instead.
 */
export async function readDocument(
  invoice: InvoiceView,
): Promise<{ document: string } | { denied: FileDenial }> {
  const row = await queryOne<{
    id: string;
    ciphertext: Buffer;
    iv: Buffer;
    auth_tag: Buffer;
    key_version: number;
  }>(
    `select id, ciphertext, iv, auth_tag, key_version
       from invoice_files where invoice_id = $1 order by created_at desc limit 1`,
    [invoice.id],
  );
  if (!row) return { denied: "no-document" };

  const document = open(
    {
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
      keyVersion: row.key_version,
    },
    row.id,
  );

  if (sha256(document).toString("base64") !== invoice.doc_hash) {
    return { denied: "hash-mismatch" };
  }
  return { document };
}
