import { NextResponse } from "next/server";
import { open } from "@/lib/crypto";
import { queryOne } from "@/lib/db";
import { publicEnv } from "@/lib/env";
import { getInvoice } from "@/lib/near";
import { readInviteToken } from "@/lib/invite-proof";
import { currentAccount } from "@/lib/session";

/**
 * The decrypted invoice document.
 *
 * Who may read it is decided against the chain on every request, never cached and never
 * taken from a session alone: the issuer, the bound client, the current holder, or
 * somebody holding a valid invite token for this invoice. Checking the holder live is
 * what makes a sale take effect immediately — the moment an invoice changes hands the
 * previous holder stops being able to read it, without waiting for anything to expire.
 *
 * After decrypting, the document is re-hashed and compared with the invoice's onchain
 * `doc_hash`. A row that no longer matches the chain is refused rather than served: it
 * means the stored file has drifted from what was signed for, and serving it would
 * present something nobody agreed to as genuine.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/invoices/[id]/file">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "No such invoice" }, { status: 404 });
  }

  try {
    const invoice = await getInvoice(publicEnv.contractId, id);
    if (!invoice) {
      return NextResponse.json({ error: "No such invoice" }, { status: 404 });
    }

    const accountId = await currentAccount();
    const inviteFor = readInviteToken(
      request.headers.get("x-ileri-invite") ?? undefined,
    );

    const allowed =
      inviteFor === id ||
      (accountId !== null &&
        (accountId === invoice.issuer ||
          accountId === invoice.client ||
          accountId === invoice.holder));

    if (!allowed) {
      // Deliberately the same answer as a missing invoice. Confirming that an invoice
      // exists but is not yours tells an enumerator something.
      return NextResponse.json({ error: "No such invoice" }, { status: 404 });
    }

    const row = await queryOne<{
      id: string;
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
      key_version: number;
    }>(
      `select id, ciphertext, iv, auth_tag, key_version
         from invoice_files where invoice_id = $1 order by created_at desc limit 1`,
      [id],
    );
    if (!row) {
      return NextResponse.json({ error: "No document stored for this invoice" }, { status: 404 });
    }

    const document = open(
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
        keyVersion: row.key_version,
      },
      row.id,
    );

    // The chain is the authority on which document belongs to this invoice.
    const { sha256 } = await import("@/lib/crypto");
    if (sha256(document).toString("base64") !== invoice.doc_hash) {
      console.error("file hash mismatch", { invoice: id });
      return NextResponse.json(
        { error: "The stored document does not match this invoice" },
        { status: 409 },
      );
    }

    return NextResponse.json({ document });
  } catch (error) {
    console.error("invoice file failed", {
      invoice: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not read that invoice" }, { status: 500 });
  }
}
