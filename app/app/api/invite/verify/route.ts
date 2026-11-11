import { NextResponse } from "next/server";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { getInvoice } from "@/lib/near";
import { spendNonce } from "@/lib/nonce";
import { issueInviteToken, verifyViewSignature, viewChallenge } from "@/lib/invite-proof";

const Body = z.object({
  invoiceId: z.string().regex(/^\d+$/),
  nonce: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.string().min(1),
});

/**
 * Prove possession of an invite key, and get a short-lived token for reading the invoice.
 *
 * The public key comes from the contract, never from the request: that is what ties the
 * proof to this specific invoice rather than to any key the caller happens to hold.
 *
 * The nonce is spent before the signature is checked, and its stored subject must match
 * the invoice, so a signature obtained for invoice 7 cannot be replayed against 8.
 */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  try {
    const spent = await spendNonce(body.nonce, "invite");
    if (!spent) {
      return NextResponse.json({ error: "That link request expired. Reload the page." }, { status: 401 });
    }
    if (spent.subject !== body.invoiceId) {
      // The nonce was issued for a different invoice. Refuse rather than let a proof
      // drift across invoices.
      return NextResponse.json({ error: "That request was for another invoice" }, { status: 401 });
    }

    const invoice = await getInvoice(publicEnv.contractId, body.invoiceId);
    if (!invoice) {
      return NextResponse.json({ error: "No such invoice" }, { status: 404 });
    }

    const challenge = viewChallenge(publicEnv.contractId, body.invoiceId, body.nonce);
    if (!verifyViewSignature(invoice.invite_pk, challenge, body.signature)) {
      return NextResponse.json({ error: "That invite link is not valid" }, { status: 401 });
    }

    return NextResponse.json({ token: issueInviteToken(body.invoiceId) });
  } catch (error) {
    console.error("invite/verify failed", {
      invoice: body.invoiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not check that link" }, { status: 500 });
  }
}
