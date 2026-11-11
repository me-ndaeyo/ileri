#!/usr/bin/env node
//
// The invite keypair, outside the browser.
//
// An invoice is authorised by whoever holds the invite link, which carries an ed25519
// private key in its URL fragment. The client's browser signs one exact message with it
// and the contract verifies that against `invite_pk`. This script does the same two
// operations from the command line so the whole journey can be walked on testnet before
// any UI exists, and so the browser implementation has something to agree with.
//
// No dependencies: Node's crypto does ed25519, and base58 is short enough to own.
//
// Usage:
//   node scripts/invite-key.mjs generate
//   node scripts/invite-key.mjs sign <secret-key-base64> <message>
//   node scripts/invite-key.mjs selftest

import { generateKeyPairSync, sign, createPrivateKey } from "node:crypto";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Bitcoin-alphabet base58, which is what NEAR uses for keys. */
function base58Encode(bytes) {
  if (bytes.length === 0) return "";

  // Repeated division of the whole buffer treated as a big-endian integer.
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  // Each leading zero byte is one leading '1', which division cannot represent.
  let leading = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    leading += BASE58[0];
  }

  return leading + digits.reverse().map((d) => BASE58[d]).join("");
}

/** The raw 32 public key bytes, dug out of the DER wrapper Node hands back. */
function rawPublicKey(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}

function generate() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    // The format `create_invoice` expects, and what NEAR prints everywhere.
    invite_pk: `ed25519:${base58Encode(rawPublicKey(publicKey))}`,
    // Opaque to everything but this script. In the real product this half lives only in
    // the URL fragment and the client's browser memory, never on a server or in a log.
    secret_key_b64: privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
  };
}

function signMessage(secretKeyB64, message) {
  const privateKey = createPrivateKey({
    key: Buffer.from(secretKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  // The contract signs the message bytes directly, not a hash of them, so there is one
  // less thing for the browser and the contract to disagree about.
  return sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");
}

/** Guards the two things most likely to be silently wrong. */
function selftest() {
  const checks = [];

  // Base58 against a published vector. A broken encoder would produce a public key the
  // contract rejects with E_BAD_INVITE_KEY, which is a confusing way to find this out.
  const vector = base58Encode(Buffer.from("hello", "utf8"));
  checks.push(["base58('hello') === 'Cn8eVZg'", vector === "Cn8eVZg", vector]);

  checks.push([
    "base58 keeps leading zeros as '1'",
    base58Encode(Buffer.from([0, 0, 1])) === "112",
    base58Encode(Buffer.from([0, 0, 1])),
  ]);

  // A NEAR ed25519 key is 32 bytes, which is 43 or 44 base58 characters.
  const { invite_pk, secret_key_b64 } = generate();
  const body = invite_pk.slice("ed25519:".length);
  checks.push([
    "public key looks like a NEAR ed25519 key",
    invite_pk.startsWith("ed25519:") && body.length >= 43 && body.length <= 44,
    invite_pk,
  ]);

  const signature = Buffer.from(signMessage(secret_key_b64, "ileri:v1:test"), "base64");
  checks.push(["signature is 64 bytes", signature.length === 64, signature.length]);

  // Signing must be deterministic: ed25519 has no nonce, so the same input must always
  // give the same output. If this ever fails, a client could not re-sign after a retry.
  checks.push([
    "signing is deterministic",
    signMessage(secret_key_b64, "x") === signMessage(secret_key_b64, "x"),
    "",
  ]);

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (got: ${detail})`}`);
    if (!ok) failed++;
  }
  return failed;
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "generate":
    console.log(JSON.stringify(generate()));
    break;
  case "sign": {
    const [secret, message] = args;
    if (!secret || message === undefined) {
      console.error("usage: invite-key.mjs sign <secret-key-base64> <message>");
      process.exit(2);
    }
    console.log(signMessage(secret, message));
    break;
  }
  case "selftest":
    process.exit(selftest() === 0 ? 0 : 1);
  default:
    console.error("usage: invite-key.mjs generate | sign <secret> <message> | selftest");
    process.exit(2);
}
