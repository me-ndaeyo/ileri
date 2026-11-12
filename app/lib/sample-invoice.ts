import type { InvoiceView } from "@/lib/near";

/**
 * Illustration for the landing page, and nothing else.
 *
 * The landing page explains the product by showing one invoice moving through its whole
 * life, so it needs an invoice to show before anybody has signed in. These are made up,
 * and they must never be mistaken for state: nothing here is read from the contract and
 * no screen that reports real money may import this file. The accounts are the same
 * testnet ones used in the walkthrough, so anybody who checks the chain finds the real
 * thing rather than a name we invented.
 *
 * Every date is a fixed `Date.UTC`, deliberately. `Date.now()` during a prerender is
 * runtime data and would stop the landing page being static, so the illustration has no
 * concept of today and the sheet is told not to count days to the due date.
 */

const DUE_MS = Date.UTC(2026, 11, 12); // 12 December 2026
const ISSUED_MS = Date.UTC(2026, 10, 11); // 11 November 2026
const ACCEPTED_MS = Date.UTC(2026, 10, 12);

const toNs = (ms: number) => (BigInt(ms) * 1_000_000n).toString();

/** 1 USDC is 1_000_000, so this is 4,250.00. */
const AMOUNT = "4250000000";

const BASE: InvoiceView = {
  id: "7",
  issuer: "test-issuer.testnet",
  client: null,
  invite_pk: "ed25519:11111111111111111111111111111111",
  holder: "test-issuer.testnet",
  token: "usdc.ileri.testnet",
  amount: AMOUNT,
  paid: "0",
  unpaid: AMOUNT,
  due_date: toNs(DUE_MS),
  doc_hash: "n0OBq8z1Xk2mR7cPvA4tY6hJ3sL9dF1gW5eQ8uI2oK0=",
  status: "Issued",
  stored_status: "Issued",
  created_at: toNs(ISSUED_MS),
  accepted_at: null,
  paid_at: null,
  reject_reason_hash: null,
  listing: null,
};

/** Who holds it, and so who the next payment reaches. */
const BUYER = "buyer.testnet";
const CLIENT = "northwind.testnet";

/**
 * The five states the landing page walks through, in order. One invoice, from the Monday
 * it was written to the day the money reached the person who bought it.
 */
export const STORY: ReadonlyArray<{
  invoice: InvoiceView;
  /** What the sheet says about itself at this point, under the stamp. */
  note: string;
}> = [
  {
    invoice: BASE,
    note: "Sent, and waiting on the client.",
  },
  {
    invoice: {
      ...BASE,
      client: CLIENT,
      status: "Accepted",
      stored_status: "Accepted",
      accepted_at: toNs(ACCEPTED_MS),
    },
    note: `Binding now, and the client is ${CLIENT}.`,
  },
  {
    invoice: {
      ...BASE,
      client: CLIENT,
      status: "Accepted",
      stored_status: "Accepted",
      accepted_at: toNs(ACCEPTED_MS),
      listing: "3900000000", // 3,900.00, below the 4,250.00 owed
    },
    note: "On the market at 3,900.00 USDC.",
  },
  {
    invoice: {
      ...BASE,
      client: CLIENT,
      holder: BUYER,
      status: "Accepted",
      stored_status: "Accepted",
      accepted_at: toNs(ACCEPTED_MS),
    },
    note: "Sold. The issuer has their 3,900.00.",
  },
  {
    invoice: {
      ...BASE,
      client: CLIENT,
      holder: BUYER,
      paid: AMOUNT,
      unpaid: "0",
      status: "Paid",
      stored_status: "Paid",
      accepted_at: toNs(ACCEPTED_MS),
      paid_at: toNs(Date.UTC(2026, 11, 10)),
    },
    note: "Paid to the holder, which is the buyer.",
  },
];

/** The sheet shown in the hero, before the story starts. */
export const HERO = STORY[STORY.length - 1].invoice;
