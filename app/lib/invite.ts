/**
 * The invite keypair.
 *
 * An invoice is authorised by whoever holds the invite link, which carries an ed25519
 * private key in its URL fragment. The issuer's browser mints the pair, keeps the public
 * half onchain as `invite_pk`, and puts the private half in the link. The client's
 * browser signs one exact message with it, and the contract checks that signature.
 *
 * Runs in the browser, which is the whole point: the private half must never reach a
 * server, a log or a database. It lives in the URL fragment and in memory, nowhere else.
 *
 * Uses @noble/ed25519 rather than WebCrypto deliberately. WebCrypto's Ed25519 is recent
 * enough that Chrome only shipped it in 137, and we have already watched a browser fail
 * `generateKey` with "Unrecognized name". A pure implementation works the same
 * everywhere, which matters for a link a client opens on a device we know nothing about.
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { base58Decode, base58Encode } from "./base58";

// @noble/ed25519 v3 needs a sha512 provided for its synchronous API.
ed.hashes.sha512 = sha512;

export interface InviteKey {
  /** 32 bytes. Never leaves the browser except inside the link's fragment. */
  secretKey: Uint8Array;
  /** `ed25519:<base58>`, which is what `create_invoice` stores as `invite_pk`. */
  publicKey: string;
}

export function generateInviteKey(): InviteKey {
  const secretKey = ed.utils.randomSecretKey();
  return {
    secretKey,
    publicKey: `ed25519:${base58Encode(ed.getPublicKey(secretKey))}`,
  };
}

/**
 * Sign the message the contract published.
 *
 * The message always comes from the contract's `invite_message` view, never rebuilt
 * here: the format binds the contract id, invoice id, caller and action, and a local
 * copy that drifted would make every accept fail for reasons nobody could see.
 *
 * Returns base64, which is what `accept_invoice` takes.
 */
export function signInviteMessage(secretKey: Uint8Array, message: string): string {
  const signature = ed.sign(new TextEncoder().encode(message), secretKey);
  return btoa(String.fromCharCode(...signature));
}

/** Pack the secret into a link fragment. Base58 to match how NEAR writes keys. */
export function encodeSecret(secretKey: Uint8Array): string {
  return base58Encode(secretKey);
}

export function decodeSecret(encoded: string): Uint8Array {
  const bytes = base58Decode(encoded);
  if (bytes.length !== 32) {
    throw new Error("That invite link is not valid");
  }
  return bytes;
}

/**
 * The invite link, shown to the issuer exactly once.
 *
 * The key sits after `#`, so browsers never put it in a Referer header, it never reaches
 * our server logs, and it is not part of what a proxy or analytics script would record.
 */
export function inviteLink(origin: string, invoiceId: string, secretKey: Uint8Array): string {
  return `${origin}/i/${invoiceId}#k=${encodeSecret(secretKey)}`;
}
