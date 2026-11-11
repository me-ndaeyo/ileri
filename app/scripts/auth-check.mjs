#!/usr/bin/env node
//
// Exercise sign-in against the running app, the real database and the real chain.
//
// Signs as a real testnet account using the key on disk, which is what a wallet would do
// in a browser. Then tries the attacks the design is supposed to refuse.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash, createPrivateKey, sign } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ACCOUNT = process.env.ACCOUNT ?? "ileri-issuer.testnet";
const RECIPIENT = "ileri";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(input) {
  const bytes = [0];
  for (const ch of input) {
    let carry = BASE58.indexOf(ch);
    if (carry < 0) throw new Error(`not base58: ${ch}`);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0;
  for (const ch of input) { if (ch !== "1") break; zeros++; }
  return Buffer.from([...Array(zeros).fill(0), ...bytes.reverse()]);
}

// The key the near CLI saved. In the browser this is the wallet's job.
const creds = JSON.parse(
  readFileSync(`${homedir()}/.near-credentials/testnet/${ACCOUNT}.json`, "utf8"),
);
const secret = base58Decode(creds.private_key.replace("ed25519:", "")).subarray(0, 32);
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), secret]),
  format: "der",
  type: "pkcs8",
});

/** Borsh-encode and hash the NEP-413 payload, exactly as lib/nep413.ts does. */
function digest({ message, nonce, recipient }) {
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
  const str = (s) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([u32(b.length), b]); };
  const payload = Buffer.concat([
    u32(2_147_484_061), str(message), Buffer.from(nonce), str(recipient), Buffer.from([0]),
  ]);
  return createHash("sha256").update(payload).digest();
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "\x1b[32mok\x1b[0m  " : "\x1b[31mFAIL\x1b[0m"} ${name}${ok ? "" : `  ${detail}`}`);
};

async function challenge() {
  const r = await fetch(`${BASE}/api/auth/challenge`, { method: "POST" });
  if (!r.ok) throw new Error(`challenge returned ${r.status}`);
  return r.json();
}

async function verify(body) {
  const r = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json(), cookie: r.headers.get("set-cookie") };
}

function signed(nonceHex, message = "Sign in to Ileri", recipient = RECIPIENT) {
  return sign(null, digest({ message, nonce: Buffer.from(nonceHex, "hex"), recipient }), privateKey)
    .toString("base64");
}

console.log(`\nsigning as ${ACCOUNT}\n`);

// --- the happy path ---
const c1 = await challenge();
check("challenge returns a 32-byte hex nonce", /^[0-9a-f]{64}$/.test(c1.nonce), c1.nonce);
check("challenge states the recipient", c1.recipient === RECIPIENT, c1.recipient);

const ok = await verify({
  accountId: ACCOUNT,
  publicKey: creds.public_key,
  signature: signed(c1.nonce),
  nonce: c1.nonce,
  message: c1.message,
});
check("a genuine signature signs in", ok.status === 200 && ok.body.accountId === ACCOUNT,
  `${ok.status} ${JSON.stringify(ok.body)}`);
check("and sets an httpOnly session cookie",
  Boolean(ok.cookie?.includes("ileri_session") && /httponly/i.test(ok.cookie)), ok.cookie ?? "none");

// --- the attacks ---
const replay = await verify({
  accountId: ACCOUNT, publicKey: creds.public_key,
  signature: signed(c1.nonce), nonce: c1.nonce, message: c1.message,
});
check("the same nonce cannot be spent twice", replay.status === 401, `${replay.status}`);

const c2 = await challenge();
const wrongRecipient = await verify({
  accountId: ACCOUNT, publicKey: creds.public_key,
  signature: signed(c2.nonce, "Sign in to Ileri", "phishing.example"),
  nonce: c2.nonce, message: c2.message,
});
check("a signature for another site is refused", wrongRecipient.status === 401, `${wrongRecipient.status}`);

const c3 = await challenge();
const wrongMessage = await verify({
  accountId: ACCOUNT, publicKey: creds.public_key,
  signature: signed(c3.nonce, "Transfer all my money"),
  nonce: c3.nonce, message: c3.message,
});
check("a signature over a different message is refused", wrongMessage.status === 401, `${wrongMessage.status}`);

// The headline attack: a perfectly valid signature from a key the account does not own.
const c4 = await challenge();
const { generateKeyPairSync } = await import("node:crypto");
const impostor = generateKeyPairSync("ed25519");
const raw = impostor.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
const BASE58E = (b) => {
  const d = [0];
  for (const byte of b) { let c = byte; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c > 0) { d.push(c % 58); c = (c / 58) | 0; } }
  return d.reverse().map((x) => BASE58[x]).join("");
};
const impostorSig = sign(null,
  digest({ message: c4.message, nonce: Buffer.from(c4.nonce, "hex"), recipient: RECIPIENT }),
  impostor.privateKey).toString("base64");
const impersonation = await verify({
  accountId: ACCOUNT, publicKey: `ed25519:${BASE58E(raw)}`,
  signature: impostorSig, nonce: c4.nonce, message: c4.message,
});
check("a valid signature from a key the account does not own is refused",
  impersonation.status === 401, `${impersonation.status} ${JSON.stringify(impersonation.body)}`);

const c5 = await challenge();
const unknownNonce = await verify({
  accountId: ACCOUNT, publicKey: creds.public_key,
  signature: signed("00".repeat(32)), nonce: "00".repeat(32), message: c5.message,
});
check("a nonce we never issued is refused", unknownNonce.status === 401, `${unknownNonce.status}`);

const malformed = await verify({ accountId: "x" });
check("a malformed body is a 400", malformed.status === 400, `${malformed.status}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
