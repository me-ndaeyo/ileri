import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { CryptoError, docHashBase64, open, seal, sha256 } from "./crypto";

beforeAll(() => {
  process.env.FILE_ENC_KEY = randomBytes(32).toString("base64");
});

const invoice = JSON.stringify({
  client: "Acme Ltd",
  lines: [{ description: "Brand design", amount: "800.00" }],
  notes: "Pay to the usual account",
});

describe("seal and open", () => {
  it("round-trips a file", () => {
    const sealed = seal(invoice, "row-1");
    expect(open(sealed, "row-1")).toBe(invoice);
  });

  it("never stores the plaintext", () => {
    const sealed = seal(invoice, "row-1");
    expect(sealed.ciphertext.toString("utf8")).not.toContain("Acme");
    expect(sealed.ciphertext.toString("base64")).not.toContain("Acme");
  });

  it("uses a fresh IV every time, so the same file encrypts differently", () => {
    // IV reuse under GCM is catastrophic, not merely weak.
    const a = seal(invoice, "row-1");
    const b = seal(invoice, "row-1");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("refuses a ciphertext moved to another row", () => {
    // The whole reason the row id is associated data: a stolen ciphertext pasted into
    // another row must fail rather than reveal one invoice in another's place.
    const sealed = seal(invoice, "row-1");
    expect(() => open(sealed, "row-2")).toThrow(CryptoError);
  });

  it("refuses a tampered ciphertext", () => {
    const sealed = seal(invoice, "row-1");
    sealed.ciphertext[0] ^= 0xff;
    expect(() => open(sealed, "row-1")).toThrow(CryptoError);
  });

  it("refuses a tampered auth tag", () => {
    const sealed = seal(invoice, "row-1");
    sealed.authTag[0] ^= 0xff;
    expect(() => open(sealed, "row-1")).toThrow(CryptoError);
  });

  it("refuses a swapped IV", () => {
    const a = seal(invoice, "row-1");
    const b = seal(invoice, "row-1");
    expect(() => open({ ...a, iv: b.iv }, "row-1")).toThrow(CryptoError);
  });

  it("refuses the wrong key", () => {
    const sealed = seal(invoice, "row-1");
    process.env.FILE_ENC_KEY = randomBytes(32).toString("base64");
    expect(() => open(sealed, "row-1")).toThrow(CryptoError);
    process.env.FILE_ENC_KEY = randomBytes(32).toString("base64");
  });

  it("refuses an unknown key version, rather than guessing", () => {
    const sealed = seal(invoice, "row-1");
    expect(() => open({ ...sealed, keyVersion: 99 }, "row-1")).toThrow(/No key for version/);
  });

  it("refuses a key that is not 32 bytes", () => {
    const good = process.env.FILE_ENC_KEY;
    process.env.FILE_ENC_KEY = randomBytes(16).toString("base64");
    expect(() => seal(invoice, "row-1")).toThrow(/32 bytes/);
    process.env.FILE_ENC_KEY = good;
  });

  it("handles unicode and an empty file", () => {
    const unicode = JSON.stringify({ client: "Café Ñoño 日本", note: "€1,200" });
    expect(open(seal(unicode, "r"), "r")).toBe(unicode);
    expect(open(seal("", "r"), "r")).toBe("");
  });
});

describe("doc_hash", () => {
  it("is the sha256 of the plaintext, so the chain can prove the file is unaltered", () => {
    expect(sha256(invoice)).toHaveLength(32);
    expect(seal(invoice, "row-1").docHash.equals(sha256(invoice))).toBe(true);
  });

  it("does not depend on the row or the encryption", () => {
    // Two rows holding the same invoice must agree with the same onchain hash.
    expect(seal(invoice, "row-1").docHash.equals(seal(invoice, "row-2").docHash)).toBe(true);
  });

  it("changes if a single character changes", () => {
    expect(docHashBase64(invoice)).not.toBe(docHashBase64(invoice + " "));
  });

  it("is base64 for the contract, 44 characters for 32 bytes", () => {
    expect(docHashBase64(invoice)).toHaveLength(44);
  });
});
