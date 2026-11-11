import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { getInvoice } from "@/lib/near";
import { readInviteToken } from "@/lib/invite-proof";
import { mayReadDocument, readDocument } from "@/lib/invoice-file";
import { currentAccount } from "@/lib/session";

/**
 * The decrypted invoice document.
 *
 * The access rule and the decryption both live in `lib/invoice-file.ts`, shared with the
 * pages that render a document, so there is one implementation to reason about.
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
    const inviteFor = readInviteToken(request.headers.get("x-ileri-invite") ?? undefined);

    if (!mayReadDocument(invoice, accountId, inviteFor)) {
      // Deliberately the same answer as a missing invoice. Confirming that an invoice
      // exists but is not yours tells an enumerator something.
      return NextResponse.json({ error: "No such invoice" }, { status: 404 });
    }

    const result = await readDocument(invoice);
    if ("denied" in result) {
      if (result.denied === "no-document") {
        return NextResponse.json({ error: "No document stored for this invoice" }, { status: 404 });
      }
      console.error("file hash mismatch", { invoice: id });
      return NextResponse.json(
        { error: "The stored document does not match this invoice" },
        { status: 409 },
      );
    }

    return NextResponse.json({ document: result.document });
  } catch (error) {
    console.error("invoice file failed", {
      invoice: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not read that invoice" }, { status: 500 });
  }
}
