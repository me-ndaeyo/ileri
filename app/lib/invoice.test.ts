import { describe, expect, it } from "vitest";
import {
  InvoiceError,
  canonicalize,
  documentHash,
  documentHashBase64,
  validateDocument,
  type InvoiceDocument,
} from "./invoice";

const document: InvoiceDocument = {
  version: "1",
  issuer: { accountId: "test-issuer.testnet", name: "Ada Okafor Studio" },
  client: { name: "Acme Ltd", email: "pay@acme.example" },
  lines: [
    { description: "Brand design", amount: "800000000" },
    { description: "Landing page", amount: "400000000" },
  ],
  total: "1200000000",
  token: "usdc.testnet",
  dueDate: "1798278624000000000",
  createdAt: "1794390626893361562",
};

describe("canonicalize", () => {
  it("does not depend on the order keys were written in", () => {
    // The trap this exists for: the browser builds the object one way and the server
    // another, both hash it, and they disagree about a file that is perfectly intact.
    const reordered = {
      createdAt: document.createdAt,
      dueDate: document.dueDate,
      token: document.token,
      total: document.total,
      lines: document.lines,
      client: document.client,
      issuer: document.issuer,
      version: document.version,
    } as InvoiceDocument;

    expect(canonicalize(reordered)).toBe(canonicalize(document));
    expect(documentHash(reordered)).toEqual(documentHash(document));
  });

  it("sorts nested objects too", () => {
    const a = { outer: { b: "2", a: "1" } };
    const b = { outer: { a: "1", b: "2" } };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("preserves array order, because reordering lines is a different invoice", () => {
    // Normalising this away would let somebody change what was agreed while keeping the
    // same hash.
    const swapped = { ...document, lines: [document.lines[1], document.lines[0]] };
    expect(documentHash(swapped)).not.toEqual(documentHash(document));
  });

  it("treats a missing optional field and an undefined one the same", () => {
    const withUndefined = { ...document, notes: undefined };
    expect(canonicalize(withUndefined)).toBe(canonicalize(document));
  });

  it("refuses numbers, which serialize differently across engines", () => {
    expect(() => canonicalize({ amount: 1200 })).toThrow(InvoiceError);
    expect(() => canonicalize({ nested: { count: 1 } })).toThrow(InvoiceError);
    // Nothing in a real document trips it, including `version`, which is a string
    // precisely so this rule needs no exceptions.
    expect(() => canonicalize(document)).not.toThrow();
  });

  it("handles unicode without changing the hash between runs", () => {
    const unicode = { ...document, client: { name: "Café Ñoño 日本" } };
    expect(documentHash(unicode)).toEqual(documentHash(structuredClone(unicode)));
  });

  it("changes the hash if any single character changes", () => {
    const hashes = new Set(
      [
        document,
        { ...document, total: "1200000001" },
        { ...document, notes: "" },
        { ...document, client: { name: "Acme Ltd." } },
        { ...document, dueDate: "1798278624000000001" },
      ].map((d) => documentHashBase64(d as InvoiceDocument)),
    );
    expect(hashes.size).toBe(5);
  });

  it("produces 44 base64 characters, as the contract expects for 32 bytes", () => {
    expect(documentHashBase64(document)).toHaveLength(44);
  });
});

describe("validateDocument", () => {
  it("accepts a consistent document", () => {
    expect(() => validateDocument(document)).not.toThrow();
  });

  it("refuses a total that does not match the lines", () => {
    // The contract only ever sees the total. If it disagreed with the lines, the invoice
    // would bill an amount the document does not justify and nothing would catch it.
    expect(() => validateDocument({ ...document, total: "999999999" })).toThrow(
      /do(es)? not match the lines/,
    );
  });

  it("refuses an empty invoice", () => {
    expect(() => validateDocument({ ...document, lines: [] })).toThrow(/at least one line/);
  });

  it("refuses a blank description or a zero line", () => {
    expect(() =>
      validateDocument({ ...document, lines: [{ description: "  ", amount: "1" }], total: "1" }),
    ).toThrow(/description/);
    expect(() =>
      validateDocument({ ...document, lines: [{ description: "x", amount: "0" }], total: "0" }),
    ).toThrow(/cannot be zero/);
  });

  it("refuses a line amount that is not in smallest units", () => {
    expect(() =>
      validateDocument({ ...document, lines: [{ description: "x", amount: "12.50" }], total: "12" }),
    ).toThrow(/smallest units/);
  });

  it("insists on a client name", () => {
    expect(() => validateDocument({ ...document, client: { name: " " } })).toThrow(/for\?/);
  });
});
