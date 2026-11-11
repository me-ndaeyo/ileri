import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { seal } from "@/lib/crypto";
import { currentAccount } from "@/lib/session";

const Body = z.object({
  /** The canonical document, serialized by the browser. Stored, never re-serialized. */
  document: z.string().min(2).max(100_000),
  /** What the browser computed. Checked here, so a mismatch is caught before minting. */
  docHash: z.string().length(44),
});

/**
 * Store an invoice document as a draft, encrypted.
 *
 * Called before the mint, because the mint needs `doc_hash` and the document has to
 * exist for that hash to mean anything. The draft carries no invoice id yet; it is bound
 * to one by `/api/drafts/link` once the transaction lands.
 *
 * The server receives the document as the exact string the browser hashed, and stores
 * that string. Re-serializing it here would risk producing different bytes and therefore
 * a different hash from the one going onchain.
 */
export async function POST(request: Request) {
  const accountId = await currentAccount();
  if (!accountId) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  try {
    // The row id is the encryption's associated data, so it must exist before sealing.
    const id = randomUUID();
    const sealed = seal(body.document, id);

    // Refuse a document whose hash does not match what the browser claims. Otherwise an
    // invoice could be minted against a hash for a different document, and the file would
    // be unservable forever: the file API checks the hash before handing anything over.
    if (sealed.docHash.toString("base64") !== body.docHash) {
      return NextResponse.json(
        { error: "That document does not match its hash" },
        { status: 400 },
      );
    }

    await query(
      `insert into invoice_files (id, issuer, ciphertext, iv, auth_tag, key_version, doc_hash)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, accountId, sealed.ciphertext, sealed.iv, sealed.authTag, sealed.keyVersion, sealed.docHash],
    );

    return NextResponse.json({ draftId: id, docHash: body.docHash });
  } catch (error) {
    // The document is never logged: it is the private part of the invoice.
    console.error("drafts failed", {
      account: accountId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not save the draft" }, { status: 500 });
  }
}
