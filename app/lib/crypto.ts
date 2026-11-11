/**
 * Invoice files at rest.
 *
 * The invoice itself — client name, line items, notes, bank references — must never
 * reach a public chain. Only its sha256 goes onchain, as `doc_hash`, which is enough to
 * prove the file was not altered without revealing anything in it.
 *
 * AES-256-GCM, with the row id as associated data. That binding is the point: a
 * ciphertext lifted from one row and pasted into another will fail to decrypt rather
 * than silently reveal one invoice in another's place.
 *
 * Server-only. The key is a credential.
 *
 * Be plain about the limit: the server sees plaintext while it encrypts and while it
 * serves. This protects the file at rest and against a database leak, not against the
 * server itself. The README says so.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Bump when rotating. Rows record which key encrypted them, so old rows still open. */
export const CURRENT_KEY_VERSION = 1;

const IV_BYTES = 12; // 96 bits, the size GCM is designed around
const TAG_BYTES = 16;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

function key(version: number): Buffer {
  if (version !== CURRENT_KEY_VERSION) {
    throw new CryptoError(`No key for version ${version}`);
  }
  const raw = process.env.FILE_ENC_KEY;
  if (!raw) {
    throw new CryptoError(
      "FILE_ENC_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const bytes = Buffer.from(raw, "base64");
  // Refuse a short key rather than let Node pad or truncate it into something weaker
  // than it looks.
  if (bytes.length !== 32) {
    throw new CryptoError(`FILE_ENC_KEY must decode to 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
  /** sha256 of the plaintext, which is what goes onchain as `doc_hash`. */
  docHash: Buffer;
}

/**
 * Encrypt a file for storage.
 *
 * `rowId` is bound in as associated data, so the result is only decryptable in the row
 * it was created for. A fresh random IV every time; reusing one under GCM would be
 * catastrophic rather than merely weak.
 */
export function seal(plaintext: string, rowId: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(CURRENT_KEY_VERSION), iv);
  cipher.setAAD(Buffer.from(rowId, "utf8"));

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);

  return {
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
    keyVersion: CURRENT_KEY_VERSION,
    docHash: sha256(plaintext),
  };
}

/**
 * Decrypt, or throw.
 *
 * GCM authenticates: a tampered ciphertext, a swapped IV or the wrong `rowId` all fail
 * here rather than returning plausible rubbish.
 */
export function open(sealed: Omit<Sealed, "docHash">, rowId: string): string {
  if (sealed.iv.length !== IV_BYTES) throw new CryptoError("Bad IV length");
  if (sealed.authTag.length !== TAG_BYTES) throw new CryptoError("Bad auth tag length");

  const decipher = createDecipheriv("aes-256-gcm", key(sealed.keyVersion), sealed.iv);
  decipher.setAAD(Buffer.from(rowId, "utf8"));
  decipher.setAuthTag(sealed.authTag);

  try {
    return Buffer.concat([
      decipher.update(sealed.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Deliberately vague. Distinguishing "wrong key" from "tampered" would be a hint.
    throw new CryptoError("Could not decrypt this file");
  }
}

export function sha256(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

/** The contract takes `doc_hash` as base64. */
export function docHashBase64(plaintext: string): string {
  return sha256(plaintext).toString("base64");
}
