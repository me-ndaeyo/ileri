/**
 * The invoice document: everything that must not go on a public chain.
 *
 * Client name, line items, notes, bank references. Only its sha256 goes onchain, as
 * `doc_hash`, which is enough to prove the file was not altered without revealing
 * anything in it.
 *
 * Shared by the browser and the server, so both must hash the document identically. That
 * is the whole reason [`canonicalize`] exists rather than a bare `JSON.stringify`.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { base58Encode } from "./base58";

/** A single billed line. Amounts are decimal strings, as money always is. */
export interface InvoiceLine {
  description: string;
  /** In the token's smallest unit, so 1 USDC is "1000000". */
  amount: string;
}

export interface InvoiceDocument {
  /**
   * Bumped if this shape ever changes, so an old document still hashes to its old hash.
   *
   * A string, not a number, because no number belongs in a document that gets hashed:
   * money is a string and a float would serialize differently across engines. One rule
   * with no exceptions is easier to keep than one with a carve-out for "small safe
   * integers".
   */
  version: "1";
  issuer: { accountId: string; name: string; email?: string };
  /** Offchain only. The onchain `client` is bound later, by whoever accepts. */
  client: { name: string; email?: string };
  lines: InvoiceLine[];
  /** Total in the smallest unit. Must equal the sum of the lines. */
  total: string;
  token: string;
  /** Nanoseconds, matching the contract. */
  dueDate: string;
  notes?: string;
  /** Nanoseconds. Part of the document, so two identical invoices still differ. */
  createdAt: string;
}

export class InvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceError";
  }
}

/**
 * Serialize a document so that the browser and the server always produce the same bytes.
 *
 * `JSON.stringify` follows insertion order, so two objects with identical content but
 * keys written in a different order serialize differently and hash differently. The
 * browser would then compute one `doc_hash`, send the document, and the server would
 * compute another and refuse to serve a file that is perfectly intact.
 *
 * So object keys are sorted recursively. Array order is preserved on purpose: reordering
 * line items genuinely is a different invoice, and silently normalising that away would
 * let somebody change what was agreed while keeping the hash.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // Numbers are deliberately not expected anywhere in a document: money is a string,
    // and a float would serialize differently across engines.
    if (typeof value === "number") {
      throw new InvoiceError("Numbers are not allowed in an invoice document; use strings");
    }
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` would be dropped by JSON.stringify anyway, so drop it consistently
    // rather than depend on that.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** The 32 bytes that go onchain. */
export function documentHash(document: InvoiceDocument): Uint8Array {
  return sha256(new TextEncoder().encode(canonicalize(document)));
}

/** `doc_hash` as `create_invoice` takes it. */
export function documentHashBase64(document: InvoiceDocument): string {
  const bytes = documentHash(document);
  // btoa in the browser, Buffer on the server; neither exists in both.
  return typeof btoa === "function"
    ? btoa(String.fromCharCode(...bytes))
    : Buffer.from(bytes).toString("base64");
}

/** Shown to a human so they can eyeball that two copies match. */
export function documentFingerprint(document: InvoiceDocument): string {
  return base58Encode(documentHash(document)).slice(0, 8);
}

/**
 * Check a document is internally consistent before it is minted.
 *
 * The total is checked against the lines because the contract only ever sees the total.
 * If they disagreed, the invoice would bill an amount the document does not justify, and
 * nothing downstream would catch it.
 */
export function validateDocument(document: InvoiceDocument): void {
  if (document.lines.length === 0) {
    throw new InvoiceError("Add at least one line");
  }
  for (const line of document.lines) {
    if (!line.description.trim()) throw new InvoiceError("Every line needs a description");
    if (!/^\d+$/.test(line.amount)) {
      throw new InvoiceError(`Line amount must be in smallest units: ${line.amount}`);
    }
    if (BigInt(line.amount) === 0n) throw new InvoiceError("A line cannot be zero");
  }

  const sum = document.lines.reduce((total, line) => total + BigInt(line.amount), 0n);
  if (sum !== BigInt(document.total)) {
    throw new InvoiceError(
      `Total ${document.total} does not match the lines, which add up to ${sum}`,
    );
  }
  if (!document.client.name.trim()) throw new InvoiceError("Who is this invoice for?");
}
