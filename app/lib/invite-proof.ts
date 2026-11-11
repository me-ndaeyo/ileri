/**
 * Proving you hold an invite link, in order to *read* an invoice.
 *
 * Separate from accepting it, and that separation is the whole point of this module.
 *
 * A client who opens an invite link must see the invoice before deciding. Showing it
 * means decrypting the offchain file, which means proving they hold the invite key. So
 * they sign a challenge. The danger is obvious once stated: if that challenge looked
 * anything like the message `accept_invoice` verifies, a signature collected merely to
 * *view* an invoice could be replayed to *accept* it, binding somebody as the client
 * without their agreement.
 *
 * So the view challenge is deliberately in a different namespace:
 *
 *     ileri-view:v1:<contract>:<invoice>:<nonce>     to read
 *     ileri:v1:<contract>:<invoice>:<caller>:accept  to accept
 *
 * The contract only ever verifies the second form, so a view signature is useless to it.
 * And the view form carries no account id, so it cannot be turned into one by swapping a
 * field.
 *
 * Server-only.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { verify } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { base58Decode } from "./base58";

// The synchronous API needs sha512 supplied.
import * as ed from "@noble/ed25519";
ed.hashes.sha512 = sha512;

/** Fifteen minutes: long enough to read an invoice, short enough to be worthless later. */
const TOKEN_TTL_MS = 15 * 60 * 1000;

export class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteError";
  }
}

/** The message an invite key signs to read an invoice. Never to act on it. */
export function viewChallenge(contractId: string, invoiceId: string, nonce: string): string {
  return `ileri-view:v1:${contractId}:${invoiceId}:${nonce}`;
}

/**
 * Check a signature against the invoice's `invite_pk`, which must come from the chain.
 *
 * Verified with the same @noble/ed25519 the browser signs with, so there is one
 * implementation on both sides of this boundary.
 */
export function verifyViewSignature(
  invitePublicKey: string,
  challenge: string,
  signatureBase64: string,
): boolean {
  const [curve, body] = invitePublicKey.split(":");
  if (curve !== "ed25519" || !body) return false;

  const key = base58Decode(body);
  if (key.length !== 32) return false;

  const signature = Buffer.from(signatureBase64, "base64");
  if (signature.length !== 64) return false;

  try {
    return verify(signature, new TextEncoder().encode(challenge), key);
  } catch {
    // A malformed point or scalar throws rather than returning false; either way the
    // answer is no.
    return false;
  }
}

interface InviteToken {
  invoiceId: string;
  expiresAt: number;
}

function secret(): Buffer {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new InviteError("SESSION_SECRET is not set or is too short");
  }
  // Domain separated from the session cookie, so an invite token can never be presented
  // as a session or the reverse, even though both are signed with the same key.
  return Buffer.from(`invite:${value}`, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Mint a short-lived token meaning "this holder proved the invite key for invoice N". */
export function issueInviteToken(invoiceId: string): string {
  const token: InviteToken = { invoiceId, expiresAt: Date.now() + TOKEN_TTL_MS };
  const payload = Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The invoice this token is good for, or `null`. */
export function readInviteToken(raw: string | undefined): string | null {
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const token = JSON.parse(Buffer.from(payload, "base64url").toString()) as InviteToken;
    if (typeof token.invoiceId !== "string" || typeof token.expiresAt !== "number") return null;
    if (token.expiresAt < Date.now()) return null;
    return token.invoiceId;
  } catch {
    return null;
  }
}
