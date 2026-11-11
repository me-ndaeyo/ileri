/**
 * NEP-413 signed messages: proving an account controls its key, without a transaction.
 *
 * This is how sign-in works. The browser asks the wallet to sign a message the server
 * chose; the server verifies the signature and that the key really belongs to the
 * account. No gas, no onchain write, and the server never sees a private key.
 *
 * Server-only. It verifies rather than signs, so it holds no secrets, but it must never
 * be imported into a client bundle: the checks here are the whole authentication
 * boundary and are worthless if a browser can decide their outcome.
 *
 * The wallet does not sign the message text. It signs `sha256(borsh(payload))`, where
 * the payload binds four things:
 *
 * | Field | Why it is there |
 * | --- | --- |
 * | tag | `2^31 + 413`, so a signed message can never be replayed as a transaction |
 * | message | what the user is agreeing to |
 * | nonce | 32 bytes we chose, single use, so an old signature cannot be reused |
 * | recipient | our app, so a signature for another site does not work here |
 */

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { base58Decode, base58Encode } from "./base58";

/** `2^31 + 413`. Keeps the signed payload out of the transaction domain entirely. */
const NEP413_TAG = 2_147_484_061;

export interface Nep413Payload {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Borsh-encode the payload, by hand.
 *
 * Borsh is simple enough here that a dependency would add more risk than it removes:
 * u32 little-endian for the tag and every string length, raw bytes for the fixed-size
 * nonce, and a single byte for the `Option` discriminant.
 */
export function serializePayload(payload: Nep413Payload): Buffer {
  if (payload.nonce.length !== 32) {
    throw new AuthError("Nonce must be exactly 32 bytes");
  }

  const u32 = (value: number) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value, 0);
    return buffer;
  };

  const string = (value: string) => {
    const bytes = Buffer.from(value, "utf8");
    // Length in bytes, not characters: a multi-byte character would otherwise shift
    // every following field and change what was signed.
    return Buffer.concat([u32(bytes.length), bytes]);
  };

  return Buffer.concat([
    u32(NEP413_TAG),
    string(payload.message),
    Buffer.from(payload.nonce),
    string(payload.recipient),
    payload.callbackUrl === undefined
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), string(payload.callbackUrl)]),
  ]);
}

/** What the wallet actually signs. */
export function payloadDigest(payload: Nep413Payload): Buffer {
  return createHash("sha256").update(serializePayload(payload)).digest();
}

/** Decode a NEAR `ed25519:<base58>` public key into its raw 32 bytes. */
export function decodePublicKey(publicKey: string): Buffer {
  const [curve, body] = publicKey.split(":");
  if (curve !== "ed25519" || !body) {
    // Only ed25519 is accepted. The contract's invite verification is ed25519-only too,
    // so allowing another curve here would be a boundary nothing downstream honours.
    throw new AuthError(`Expected an ed25519 public key, got ${publicKey}`);
  }
  // The shared decoder is browser-safe and so returns Uint8Array; wrap it for the Node
  // crypto calls below, which want a Buffer.
  const raw = Buffer.from(base58Decode(body));
  if (raw.length !== 32) {
    throw new AuthError(`An ed25519 public key is 32 bytes, got ${raw.length}`);
  }
  return raw;
}

/**
 * Verify a NEP-413 signature.
 *
 * Returns `true` only if this exact payload was signed by this exact key. It says nothing
 * about whether the key belongs to the account: that is a separate check against the
 * chain, because a signature from a key nobody owns proves nothing.
 */
export function verifyNep413(
  payload: Nep413Payload,
  publicKey: string,
  signatureBase64: string,
): boolean {
  const signature = Buffer.from(signatureBase64, "base64");
  if (signature.length !== 64) return false;

  // Node needs a DER-wrapped key; ed25519 SPKI is a fixed 12-byte prefix plus the key.
  const der = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    decodePublicKey(publicKey),
  ]);
  const key = createPublicKey({ key: der, format: "der", type: "spki" });

  // `null` algorithm: ed25519 signs the given bytes directly, and those bytes are the
  // sha256 digest of the payload, not the payload itself.
  return verifySignature(null, payloadDigest(payload), key, signature);
}

// Re-exported so callers that already import these from here keep working, while there
// is only one implementation.
export { base58Decode, base58Encode };
