import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  AuthError,
  base58Decode,
  base58Encode,
  decodePublicKey,
  payloadDigest,
  serializePayload,
  verifyNep413,
  type Nep413Payload,
} from "./nep413";

/** A wallet, as far as these tests are concerned. */
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  return {
    publicKey: `ed25519:${base58Encode(raw)}`,
    /** Signs exactly what a NEP-413 wallet signs: the digest, not the message. */
    sign: (payload: Nep413Payload) =>
      sign(null, payloadDigest(payload), privateKey).toString("base64"),
  };
}

const nonce = (fill = 7) => new Uint8Array(32).fill(fill);

const base: Nep413Payload = {
  message: "Sign in to Ileri",
  nonce: nonce(),
  recipient: "ileri.app",
};

describe("base58", () => {
  it("matches published vectors", () => {
    expect(base58Encode(Buffer.from("hello", "utf8"))).toBe("Cn8eVZg");
    expect(base58Decode("Cn8eVZg").toString("utf8")).toBe("hello");
  });

  it("round-trips 32 random bytes, which is what a key is", () => {
    for (let i = 0; i < 20; i++) {
      const bytes = Buffer.from(
        Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)),
      );
      expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    }
  });

  it("keeps leading zeros, which are otherwise lost", () => {
    const withZeros = Buffer.from([0, 0, 1, 2, 3]);
    expect(base58Decode(base58Encode(withZeros))).toEqual(withZeros);
  });

  it("rejects characters outside the alphabet", () => {
    // 0, O, I and l are excluded on purpose, so they must not decode.
    for (const bad of ["0", "O", "I", "l", "hello!"]) {
      expect(() => base58Decode(bad), bad).toThrow(AuthError);
    }
  });
});

describe("decodePublicKey", () => {
  it("decodes a NEAR ed25519 key to 32 bytes", () => {
    expect(decodePublicKey(wallet().publicKey)).toHaveLength(32);
  });

  it("refuses anything that is not ed25519", () => {
    // The contract's invite check is ed25519-only, so accepting another curve here
    // would be a boundary nothing downstream honours.
    expect(() => decodePublicKey("secp256k1:abc")).toThrow(/ed25519/);
    expect(() => decodePublicKey("abc")).toThrow(/ed25519/);
    expect(() => decodePublicKey("ed25519:")).toThrow(/ed25519/);
  });

  it("refuses a key of the wrong length", () => {
    expect(() => decodePublicKey(`ed25519:${base58Encode(new Uint8Array(31))}`)).toThrow(
      /32 bytes/,
    );
  });
});

describe("the signed payload", () => {
  it("starts with the NEP-413 tag, so it can never be read as a transaction", () => {
    expect(serializePayload(base).readUInt32LE(0)).toBe(2_147_484_061);
  });

  it("measures strings in bytes, not characters", () => {
    // A multi-byte character would otherwise shift every later field and change what
    // was actually signed.
    const ascii = serializePayload({ ...base, message: "aaaa" });
    const unicode = serializePayload({ ...base, message: "aaé" });
    expect(unicode.length).toBe(ascii.length);
    expect(unicode.readUInt32LE(4)).toBe(4);
  });

  it("insists on a 32-byte nonce", () => {
    expect(() => serializePayload({ ...base, nonce: new Uint8Array(31) })).toThrow(
      /32 bytes/,
    );
  });

  it("encodes callbackUrl as an Option", () => {
    const without = serializePayload(base);
    const with_ = serializePayload({ ...base, callbackUrl: "https://ileri.app/cb" });
    expect(without[without.length - 1]).toBe(0);
    expect(with_.length).toBeGreaterThan(without.length);
  });

  it("gives a different digest for every field that changes", () => {
    const digests = new Set(
      [
        base,
        { ...base, message: "Something else" },
        { ...base, nonce: nonce(8) },
        { ...base, recipient: "evil.app" },
        { ...base, callbackUrl: "https://ileri.app" },
      ].map((p) => payloadDigest(p).toString("hex")),
    );
    expect(digests.size).toBe(5);
  });
});

describe("verifyNep413", () => {
  it("accepts a genuine signature", () => {
    const w = wallet();
    expect(verifyNep413(base, w.publicKey, w.sign(base))).toBe(true);
  });

  it("rejects a signature from a different key", () => {
    const signature = wallet().sign(base);
    expect(verifyNep413(base, wallet().publicKey, signature)).toBe(false);
  });

  // Each of these is the attack the corresponding payload field exists to stop.
  it("rejects a signature for a different message", () => {
    const w = wallet();
    const signature = w.sign({ ...base, message: "Transfer all my money" });
    expect(verifyNep413(base, w.publicKey, signature)).toBe(false);
  });

  it("rejects a replayed nonce", () => {
    const w = wallet();
    const signature = w.sign({ ...base, nonce: nonce(1) });
    expect(verifyNep413(base, w.publicKey, signature)).toBe(false);
  });

  it("rejects a signature issued for another site", () => {
    const w = wallet();
    const signature = w.sign({ ...base, recipient: "phishing.example" });
    expect(verifyNep413(base, w.publicKey, signature)).toBe(false);
  });

  it("rejects a malformed or truncated signature without throwing", () => {
    const w = wallet();
    // A bad signature must be a plain `false`, never an exception that a caller might
    // catch and mistake for something recoverable.
    for (const bad of ["", "aGVsbG8=", Buffer.alloc(63).toString("base64")]) {
      expect(verifyNep413(base, w.publicKey, bad)).toBe(false);
    }
  });

  it("rejects a signature over the raw message instead of the digest", () => {
    // A wallet that signed the text rather than sha256(borsh(payload)) must not pass.
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
    const wrong = sign(null, Buffer.from(base.message, "utf8"), privateKey).toString(
      "base64",
    );
    expect(verifyNep413(base, `ed25519:${base58Encode(raw)}`, wrong)).toBe(false);
  });
});
