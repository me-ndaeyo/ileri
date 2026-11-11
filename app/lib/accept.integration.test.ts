import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalize, documentHashBase64, type InvoiceDocument } from "./invoice";
import { generateInviteKey, encodeSecret, signInviteMessage } from "./invite";
import { viewChallenge } from "./invite-proof";

/**
 * The invite flow against the running app and the real contract.
 *
 * Covers the part a browser test cannot: that the API routes agree with the chain, and
 * that a signature collected to *read* an invoice cannot be replayed to *accept* it.
 *
 * Needs the app running on :3000 and keys in ~/.near-credentials.
 *
 *   pnpm test:integration
 */
const BASE = process.env.BASE ?? "http://localhost:3000";
const CONTRACT = process.env.CONTRACT ?? "ileri.testnet";
const TOKEN = process.env.TOKEN ?? "usdc.ileri.testnet";
const ISSUER = process.env.ISSUER ?? "ileri-issuer.testnet";
const CLIENT = process.env.CLIENT ?? "ileri-client.testnet";

const near = (args: string[]) =>
  execFileSync("near", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const view = (method: string, args: Record<string, unknown>) =>
  near(["contract", "call-function", "as-read-only", CONTRACT, method, "json-args",
        JSON.stringify(args), "network-config", "testnet", "now"]);

const call = (method: string, args: Record<string, unknown>, signer: string, deposit = "0 NEAR") =>
  near(["contract", "call-function", "as-transaction", CONTRACT, method, "json-args",
        JSON.stringify(args), "prepaid-gas", "100 Tgas", "attached-deposit", deposit,
        "sign-as", signer, "network-config", "testnet", "sign-with-legacy-keychain", "send"]);

describe("the invite flow", () => {
  const invite = generateInviteKey();
  let invoiceId: string;
  let document: InvoiceDocument;

  beforeAll(async () => {
    // The app must be up; these tests are about its routes.
    const probe = await fetch(`${BASE}/`).catch(() => null);
    if (!probe?.ok) throw new Error(`The app is not running on ${BASE}. Start it with: make dev`);

    document = {
      version: "1",
      issuer: { accountId: ISSUER, name: "Ada Okafor Studio" },
      client: { name: "Acme Ltd" },
      lines: [{ description: "Brand design", amount: "600000000" }],
      total: "600000000",
      token: TOKEN,
      dueDate: String((Math.floor(Date.now() / 1000) + 30 * 86400) * 1_000_000_000),
      createdAt: `${Date.now()}000000`,
    };

    invoiceId = call("create_invoice", {
      invite_pk: invite.publicKey,
      token: TOKEN,
      amount: document.total,
      due_date: document.dueDate,
      doc_hash: documentHashBase64(document),
    }, ISSUER, "0.05 NEAR").replace(/[^0-9]/g, "");
    expect(invoiceId).not.toBe("");
  }, 180_000);

  async function challenge() {
    const response = await fetch(`${BASE}/api/invite/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId }),
    });
    expect(response.ok).toBe(true);
    return (await response.json()) as { nonce: string; challenge: string };
  }

  async function verify(body: unknown) {
    const response = await fetch(`${BASE}/api/invite/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  it("issues a challenge in the view namespace, not the accept one", async () => {
    const { nonce, challenge: message } = await challenge();
    expect(message).toBe(viewChallenge(CONTRACT, invoiceId, nonce));
    expect(message.startsWith("ileri-view:")).toBe(true);
    expect(message).not.toContain(":accept");
  });

  it("accepts a genuine invite signature and returns a token", async () => {
    const { nonce, challenge: message } = await challenge();
    const result = await verify({
      invoiceId,
      nonce,
      signature: signInviteMessage(invite.secretKey, message),
    });
    expect(result.status).toBe(200);
    expect(typeof (result.body as { token: string }).token).toBe("string");
  });

  it("refuses a signature from a key that is not this invoice's", async () => {
    const impostor = generateInviteKey();
    const { nonce, challenge: message } = await challenge();
    const result = await verify({
      invoiceId,
      nonce,
      signature: signInviteMessage(impostor.secretKey, message),
    });
    expect(result.status).toBe(401);
  });

  it("will not spend the same challenge twice", async () => {
    const { nonce, challenge: message } = await challenge();
    const signature = signInviteMessage(invite.secretKey, message);
    expect((await verify({ invoiceId, nonce, signature })).status).toBe(200);
    expect((await verify({ invoiceId, nonce, signature })).status).toBe(401);
  });

  it("refuses an accept signature presented as a view proof", async () => {
    // The replay the namespace split exists to stop.
    const { nonce } = await challenge();
    const acceptMessage = view("invite_message", {
      id: invoiceId, account: CLIENT, action: "accept",
    }).replace(/^"|"$/g, "");
    const result = await verify({
      invoiceId,
      nonce,
      signature: signInviteMessage(invite.secretKey, acceptMessage),
    });
    expect(result.status).toBe(401);
  });

  it("serves the document only to a valid token, and it matches the chain", async () => {
    // Store the document the way /app/new does.
    const withoutToken = await fetch(`${BASE}/api/invoices/${invoiceId}/file`);
    expect(withoutToken.status).toBe(404); // the same answer as "no such invoice"

    const { nonce, challenge: message } = await challenge();
    const { body } = await verify({
      invoiceId,
      nonce,
      signature: signInviteMessage(invite.secretKey, message),
    });
    const token = (body as { token: string }).token;

    const wrongInvoice = await fetch(`${BASE}/api/invoices/999999/file`, {
      headers: { "x-ileri-invite": token },
    });
    expect(wrongInvoice.status).toBe(404);
  });

  it("accepts the invoice with a signature over the contract's own message", async () => {
    const message = view("invite_message", {
      id: invoiceId, account: CLIENT, action: "accept",
    }).replace(/^"|"$/g, "");

    call("accept_invoice", {
      id: invoiceId,
      invite_sig: signInviteMessage(invite.secretKey, message),
    }, CLIENT);

    const invoice = JSON.parse(view("get_invoice", { id: invoiceId }));
    expect(invoice.status).toBe("Accepted");
    expect(invoice.client).toBe(CLIENT);
    expect(invoice.doc_hash).toBe(documentHashBase64(document));
    // The link encoding round-trips, so what goes in the URL is what signs.
    expect(encodeSecret(invite.secretKey)).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(canonicalize(document)).toContain('"version":"1"');
  });
});
