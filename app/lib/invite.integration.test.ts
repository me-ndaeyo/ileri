import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateInviteKey, signInviteMessage } from "./invite";

/**
 * Does the browser's invite crypto agree with the contract's?
 *
 * The invite flow has two independent ed25519 implementations either side of a boundary:
 * `@noble/ed25519` in the browser, and `env::ed25519_verify` in the contract. If they
 * disagree about key encoding or about what exactly gets signed, every accept fails with
 * E_BAD_SIGNATURE and nothing says why.
 *
 * So this does the real thing against testnet: mint a key the way the browser will,
 * create an invoice with it, sign the message the contract publishes, and call
 * accept_invoice. Passing means the two sides genuinely agree.
 *
 * Opt-in, because it spends testnet gas and needs keys in ~/.near-credentials:
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

const call = (
  method: string,
  args: Record<string, unknown>,
  signer: string,
  deposit = "0 NEAR",
) =>
  near(["contract", "call-function", "as-transaction", CONTRACT, method, "json-args",
        JSON.stringify(args), "prepaid-gas", "100 Tgas", "attached-deposit", deposit,
        "sign-as", signer, "network-config", "testnet", "sign-with-legacy-keychain", "send"]);

describe("the browser's invite key against the real contract", () => {
  it("mints a key the contract accepts, and signs a message it verifies", () => {
    // Exactly what the issuer's browser will do.
    const invite = generateInviteKey();
    expect(invite.publicKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);

    const dueDate = String((Math.floor(Date.now() / 1000) + 30 * 86400) * 1_000_000_000);
    const id = call(
      "create_invoice",
      {
        invite_pk: invite.publicKey,
        token: TOKEN,
        amount: "500000000",
        due_date: dueDate,
        doc_hash: Buffer.alloc(32, 3).toString("base64"),
      },
      ISSUER,
      "0.05 NEAR",
    ).replace(/[^0-9]/g, "");

    // An empty id means the contract refused the key outright, which would be an
    // encoding disagreement rather than a signing one.
    expect(id, "the contract rejected a browser-made public key").not.toBe("");

    // The message always comes from the contract, never rebuilt locally.
    const message = view("invite_message", { id, account: CLIENT, action: "accept" })
      .replace(/^"|"$/g, "");
    expect(message).toBe(`ileri:v1:${CONTRACT}:${id}:${CLIENT}:accept`);

    // The moment of truth: the contract's own ed25519_verify on a browser signature.
    call("accept_invoice", { id, invite_sig: signInviteMessage(invite.secretKey, message) }, CLIENT);

    const invoice = JSON.parse(view("get_invoice", { id }));
    expect(invoice.status).toBe("Accepted");
    expect(invoice.client).toBe(CLIENT);
  }, 180_000);
});
