import { NextResponse } from "next/server";
import { z } from "zod";
import { issueNonce } from "@/lib/nonce";
import { publicEnv } from "@/lib/env";
import { viewChallenge } from "@/lib/invite-proof";

const Body = z.object({ invoiceId: z.string().regex(/^\d+$/) });

/**
 * A challenge for an invite key to sign, in order to read an invoice.
 *
 * Open to anyone: it returns 32 random bytes and a message. Only somebody holding the
 * invite key can produce a signature over it, and the nonce is stored so that signature
 * is single use.
 *
 * The nonce records which invoice it was issued for, so a signature obtained for one
 * invoice cannot be spent reading another.
 */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  try {
    const { nonce } = await issueNonce("invite", body.invoiceId);
    return NextResponse.json({
      nonce,
      challenge: viewChallenge(publicEnv.contractId, body.invoiceId, nonce),
    });
  } catch (error) {
    console.error("invite/challenge failed", {
      invoice: body.invoiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not start" }, { status: 500 });
  }
}
