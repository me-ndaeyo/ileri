import { describe, expect, it } from "vitest";
import { generateInviteKey, signInviteMessage } from "./invite";
import { parseSession } from "./session";
import {
  InviteError,
  issueInviteToken,
  readInviteToken,
  verifyViewSignature,
  viewChallenge,
} from "./invite-proof";

process.env.SESSION_SECRET ??= "x".repeat(44);

const CONTRACT = "ileri.testnet";

describe("the view challenge", () => {
  it("is in a different namespace from the accept message", () => {
    // This is the whole reason the module exists. A signature collected to read an
    // invoice must be worthless for accepting it.
    const challenge = viewChallenge(CONTRACT, "7", "abc");
    expect(challenge).toBe("ileri-view:v1:ileri.testnet:7:abc");
    expect(challenge).not.toContain(":accept");
    expect(challenge.startsWith("ileri:")).toBe(false);
  });

  it("carries no account id, so no field can be swapped to make an accept", () => {
    // The accept message is ileri:v1:<contract>:<id>:<caller>:accept. There is nowhere
    // in the view form for a caller to go.
    expect(viewChallenge(CONTRACT, "7", "abc").split(":")).toHaveLength(5);
  });

  it("changes with the nonce, so a signature cannot be reused", () => {
    expect(viewChallenge(CONTRACT, "7", "a")).not.toBe(viewChallenge(CONTRACT, "7", "b"));
  });
});

describe("verifyViewSignature", () => {
  const invite = generateInviteKey();
  const challenge = viewChallenge(CONTRACT, "7", "nonce-1");

  it("accepts a genuine signature from the invite key", () => {
    expect(
      verifyViewSignature(invite.publicKey, challenge, signInviteMessage(invite.secretKey, challenge)),
    ).toBe(true);
  });

  it("rejects another key's signature", () => {
    const other = generateInviteKey();
    expect(
      verifyViewSignature(invite.publicKey, challenge, signInviteMessage(other.secretKey, challenge)),
    ).toBe(false);
  });

  it("rejects a signature over a different challenge", () => {
    const stale = viewChallenge(CONTRACT, "7", "nonce-2");
    expect(
      verifyViewSignature(invite.publicKey, challenge, signInviteMessage(invite.secretKey, stale)),
    ).toBe(false);
  });

  it("rejects a signature for a different invoice", () => {
    const other = viewChallenge(CONTRACT, "8", "nonce-1");
    expect(
      verifyViewSignature(invite.publicKey, challenge, signInviteMessage(invite.secretKey, other)),
    ).toBe(false);
  });

  it("rejects an accept signature presented as a view proof", () => {
    // The attack the namespace split prevents, from the other direction.
    const acceptMessage = `ileri:v1:${CONTRACT}:7:attacker.testnet:accept`;
    expect(
      verifyViewSignature(
        invite.publicKey,
        challenge,
        signInviteMessage(invite.secretKey, acceptMessage),
      ),
    ).toBe(false);
  });

  it("returns false rather than throwing on rubbish", () => {
    for (const bad of ["", "not-base64!!", Buffer.alloc(63).toString("base64")]) {
      expect(verifyViewSignature(invite.publicKey, challenge, bad)).toBe(false);
    }
    expect(verifyViewSignature("secp256k1:abc", challenge, "x")).toBe(false);
    expect(verifyViewSignature("ed25519:", challenge, "x")).toBe(false);
  });
});

describe("the invite token", () => {
  it("round-trips the invoice it is good for", () => {
    expect(readInviteToken(issueInviteToken("7"))).toBe("7");
  });

  it("is not valid for another invoice", () => {
    expect(readInviteToken(issueInviteToken("7"))).not.toBe("8");
  });

  it("refuses a tampered payload", () => {
    const token = issueInviteToken("7");
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ invoiceId: "8", expiresAt: Date.now() + 1000 }))
      .toString("base64url");
    expect(readInviteToken(`${forged}.${signature}`)).toBeNull();
    expect(readInviteToken(`${payload}.${"a".repeat(signature.length)}`)).toBeNull();
  });

  it("refuses an expired token", () => {
    const expired = Buffer.from(JSON.stringify({ invoiceId: "7", expiresAt: Date.now() - 1 }))
      .toString("base64url");
    // Even correctly signed, which it cannot be from outside, expiry still applies.
    expect(readInviteToken(`${expired}.whatever`)).toBeNull();
  });

  it("refuses rubbish", () => {
    for (const bad of [undefined, "", "a", "a.b.c"]) {
      expect(readInviteToken(bad)).toBeNull();
    }
  });

  it("is domain separated from the session cookie", () => {
    // Both are HMACs under SESSION_SECRET. An invite token must not be presentable as a
    // session, nor the reverse, so the key is namespaced.
    const token = issueInviteToken("7");
    expect(parseSession(token)).toBeNull();
  });

  it("insists on a real secret", () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "short";
    expect(() => issueInviteToken("7")).toThrow(InviteError);
    process.env.SESSION_SECRET = saved;
  });
});
