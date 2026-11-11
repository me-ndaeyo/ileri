import { NextResponse } from "next/server";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { getInvoice } from "@/lib/near";
import { publicEnv } from "@/lib/env";
import { currentAccount } from "@/lib/session";

const Body = z.object({
  draftId: z.string().uuid(),
  invoiceId: z.string().regex(/^\d+$/),
});

/**
 * Bind a draft to the invoice that was just minted.
 *
 * Deliberately not something the client is trusted about. The contract is consulted and
 * three things must agree before anything is written: the caller issued that invoice,
 * the draft belongs to the caller, and the invoice's onchain `doc_hash` matches the
 * draft's. Without the hash check somebody could attach their own document to another
 * person's invoice, and the file API would then serve it as genuine.
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
    const draft = await queryOne<{ doc_hash: Buffer; invoice_id: string | null }>(
      `select doc_hash, invoice_id from invoice_files where id = $1 and issuer = $2`,
      [body.draftId, accountId],
    );
    if (!draft) {
      return NextResponse.json({ error: "No such draft" }, { status: 404 });
    }
    if (draft.invoice_id) {
      // Already linked. Idempotent if it is the same invoice, refused if not: a draft
      // belongs to one invoice and re-pointing it would orphan the first.
      return draft.invoice_id === body.invoiceId
        ? NextResponse.json({ invoiceId: draft.invoice_id })
        : NextResponse.json({ error: "That draft is already linked" }, { status: 409 });
    }

    const invoice = await getInvoice(publicEnv.contractId, body.invoiceId);
    if (!invoice) {
      return NextResponse.json({ error: "No such invoice" }, { status: 404 });
    }
    if (invoice.issuer !== accountId) {
      return NextResponse.json({ error: "That is not your invoice" }, { status: 403 });
    }
    // The chain is the authority on which document this invoice is for.
    if (invoice.doc_hash !== draft.doc_hash.toString("base64")) {
      return NextResponse.json(
        { error: "That draft is not the document this invoice was minted for" },
        { status: 409 },
      );
    }

    await query(`update invoice_files set invoice_id = $1 where id = $2`, [
      body.invoiceId,
      body.draftId,
    ]);

    return NextResponse.json({ invoiceId: body.invoiceId });
  } catch (error) {
    console.error("drafts/link failed", {
      account: accountId,
      draft: body.draftId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not link the draft" }, { status: 500 });
  }
}
