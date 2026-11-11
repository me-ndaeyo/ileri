import { NextResponse } from "next/server";
import { z } from "zod";
import { accountHasKey } from "@/lib/near";
import { spendNonce } from "@/lib/nonce";
import { verifyNep413 } from "@/lib/nep413";
import { setSession } from "@/lib/session";
import { RECIPIENT } from "../challenge/route";

const Body = z.object({
  accountId: z.string().min(2).max(64),
  publicKey: z.string().startsWith("ed25519:"),
  signature: z.string().min(1),
  nonce: z.string().regex(/^[0-9a-f]{64}$/, "nonce must be 32 bytes of hex"),
  message: z.string().min(1),
});

/**
 * Complete sign-in.
 *
 * Four things must all hold, and the order matters: each step is cheaper than the next,
 * and the nonce is spent before anything expensive so a flood of bad requests cannot be
 * used to hammer the RPC.
 *
 *  1. the body is the right shape
 *  2. the nonce is one we issued, unspent and unexpired
 *  3. the signature covers exactly this message, nonce and recipient
 *  4. the key is actually an access key on the claimed account
 *
 * Step 4 is what stops the obvious attack: generate a keypair, sign the challenge
 * perfectly, and claim to be anyone. A signature alone proves possession of *a* key, not
 * of *that account's* key.
 */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  try {
    // Spend first. It is a single atomic update, so two requests racing with the same
    // nonce cannot both proceed.
    const spent = await spendNonce(body.nonce, "login");
    if (!spent) {
      return NextResponse.json(
        { error: "That sign in request has expired. Try again." },
        { status: 401 },
      );
    }

    const signatureValid = verifyNep413(
      {
        message: body.message,
        nonce: Uint8Array.from(Buffer.from(body.nonce, "hex")),
        recipient: RECIPIENT,
      },
      body.publicKey,
      body.signature,
    );
    if (!signatureValid) {
      return NextResponse.json({ error: "Signature did not check out" }, { status: 401 });
    }

    if (!(await accountHasKey(body.accountId, body.publicKey))) {
      return NextResponse.json(
        { error: "That key does not belong to that account" },
        { status: 401 },
      );
    }

    await setSession(body.accountId);
    return NextResponse.json({ accountId: body.accountId });
  } catch (error) {
    // Never echo the cause to the client: it would distinguish "no such account" from
    // "RPC down", which is detail an attacker can use and a user cannot.
    console.error("auth/verify failed", {
      account: body.accountId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not complete sign in" }, { status: 500 });
  }
}
