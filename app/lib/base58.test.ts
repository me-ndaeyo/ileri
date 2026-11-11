import { describe, expect, it } from "vitest";
import { Base58Error, base58Decode, base58Encode } from "./base58";

/**
 * One implementation shared by the browser and the server, so these tests guard the
 * thing most likely to go wrong silently: a public key that encodes differently in one
 * place than the other, which the contract would reject for no visible reason.
 */
describe("base58", () => {
  it("matches published vectors", () => {
    expect(base58Encode(new TextEncoder().encode("hello"))).toBe("Cn8eVZg");
    expect(new TextDecoder().decode(base58Decode("Cn8eVZg"))).toBe("hello");
  });

  it("round-trips 32 random bytes, which is what a key is", () => {
    for (let i = 0; i < 50; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    }
  });

  it("keeps leading zeros, which carry no value and are otherwise lost", () => {
    for (const bytes of [
      new Uint8Array([0, 0, 1]),
      new Uint8Array([0]),
      new Uint8Array([0, 0, 0, 0, 255]),
    ]) {
      expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    }
  });

  it("encodes an empty input as an empty string", () => {
    expect(base58Encode(new Uint8Array())).toBe("");
  });

  it("rejects characters outside the alphabet", () => {
    // 0, O, I and l are excluded on purpose, so they must not decode.
    for (const bad of ["0", "O", "I", "l", "hello!", " "]) {
      expect(() => base58Decode(bad), bad).toThrow(Base58Error);
    }
  });

  it("produces 43 or 44 characters for a 32-byte key, as NEAR keys look", () => {
    for (let i = 0; i < 20; i++) {
      const length = base58Encode(crypto.getRandomValues(new Uint8Array(32))).length;
      expect(length).toBeGreaterThanOrEqual(43);
      expect(length).toBeLessThanOrEqual(44);
    }
  });
});
