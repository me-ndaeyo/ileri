import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { canonicalize, documentHashBase64, type InvoiceDocument } from "./invoice";
import { generateInviteKey, signInviteMessage } from "./invite";

/**
 * The issue flow's crypto, end to end against testnet.
 *
 * The browser builds a document, canonicalizes it, hashes it, and the hash goes onchain.
 * The risk is the hash: if what the browser hashes differs by one byte from what the
 * server stores, the invoice mints fine and the file is unservable forever, because the
 * file API refuses to hand over anything whose hash does not match the chain.
 *
 * So this mints a real invoice from a real document and checks the chain agrees about
 * the hash, then accepts it with the invite key to prove the pair still works together.
 *
 *   pnpm test:integration
 */
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

describe("issuing an invoice from a real document", () => {
  it("puts a hash on chain that the document still matches", () => {
    const document: InvoiceDocument = {
      version: "1",
      issuer: { accountId: ISSUER, name: "Ada Okafor Studio" },
      client: { name: "Acme Ltd", email: "pay@acme.example" },
      lines: [
        { description: "Brand design", amount: "800000000" },
        { description: "Landing page", amount: "400000000" },
      ],
      total: "1200000000",
      token: TOKEN,
      dueDate: String((Math.floor(Date.now() / 1000) + 30 * 86400) * 1_000_000_000),
      notes: "Thirty days. Café Ñoño 日本 to check unicode survives.",
      createdAt: `${Date.now()}000000`,
    };

    const docHash = documentHashBase64(document);
    const invite = generateInviteKey();

    const id = call("create_invoice", {
      invite_pk: invite.publicKey,
      token: TOKEN,
      amount: document.total,
      due_date: document.dueDate,
      doc_hash: docHash,
    }, ISSUER, "0.05 NEAR").replace(/[^0-9]/g, "");
    expect(id).not.toBe("");

    const invoice = JSON.parse(view("get_invoice", { id }));

    // The whole point: the chain's hash must equal what the browser computed, and
    // recomputing from the canonical string must give the same answer again.
    expect(invoice.doc_hash).toBe(docHash);
    expect(canonicalize(document)).toBe(canonicalize(JSON.parse(canonicalize(document))));
    expect(invoice.amount).toBe(document.total);
    expect(invoice.due_date).toBe(document.dueDate);
    expect(invoice.status).toBe("Issued");
    expect(invoice.client).toBeNull();

    // And the invite key minted alongside it still works.
    const message = view("invite_message", { id, account: CLIENT, action: "accept" })
      .replace(/^"|"$/g, "");
    call("accept_invoice", { id, invite_sig: signInviteMessage(invite.secretKey, message) }, CLIENT);

    const accepted = JSON.parse(view("get_invoice", { id }));
    expect(accepted.status).toBe("Accepted");
    expect(accepted.client).toBe(CLIENT);
    // Accepting must not disturb the document binding.
    expect(accepted.doc_hash).toBe(docHash);
  }, 180_000);
});
