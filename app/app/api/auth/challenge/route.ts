import { NextResponse } from "next/server";
import { issueNonce } from "@/lib/nonce";

/**
 * Issue a sign-in challenge.
 *
 * The nonce is chosen by the server and stored, so the signature that comes back can
 * only be spent once. A client-chosen nonce would let somebody reuse an old signature
 * forever.
 *
 * Open to anyone: it hands out nothing but 32 random bytes, and the account is not known
 * until a signature arrives.
 */
export async function POST() {
  try {
    const { nonce } = await issueNonce("login");
    return NextResponse.json({
      nonce,
      // What the wallet will show the user. Plain words, since they have to read it.
      message: "Sign in to Ileri",
      recipient: RECIPIENT,
    });
  } catch (error) {
    console.error("auth/challenge failed", { error: describe(error) });
    return NextResponse.json({ error: "Could not start sign in" }, { status: 500 });
  }
}

/**
 * Who the signature is for.
 *
 * Bound into the NEP-413 payload, so a signature obtained by another site cannot be
 * replayed here. It must match what the browser sends to the wallet exactly.
 */
export const RECIPIENT = "ileri";

/** Errors are logged without bodies or values, per the no-leak rules. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
