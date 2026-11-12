/**
 * Reading the contract.
 *
 * View calls over JSON-RPC with `fetch`, rather than through a wallet library, because
 * reads need no signing and no browser. That means a server component can render live
 * chain state directly, which is how every page here gets its data.
 *
 * The contract is the only source of truth for money and status. Nothing in this module
 * caches, and nothing derives "Paid" from anywhere else.
 */

import { rpcUrl } from "./env";

/** Status as the contract stores it. */
export type Status =
  | "Issued"
  | "Accepted"
  | "Rejected"
  | "Cancelled"
  | "PartiallyPaid"
  | "Paid";

/** Status as views report it: the stored set plus `Overdue`, derived at read time. */
export type StatusView = Status | "Overdue";

/**
 * An invoice as `get_invoice` returns it.
 *
 * Every amount and timestamp is a decimal string, because `U128` and `U64` cross the ABI
 * that way. They stay strings here and are converted only by `lib/money.ts`.
 */
export interface InvoiceView {
  id: string;
  issuer: string;
  client: string | null;
  invite_pk: string;
  /** Whoever holds the NFT now, and so who the next payment goes to. */
  holder: string | null;
  token: string;
  amount: string;
  paid: string;
  unpaid: string;
  due_date: string;
  /** base64. near-sdk's ABI schema claims an array of bytes, but the wire format is a string. */
  doc_hash: string;
  /** Includes the derived `Overdue`. */
  status: StatusView;
  /** What is actually in storage, with `Overdue` never substituted. */
  stored_status: Status;
  created_at: string;
  accepted_at: string | null;
  paid_at: string | null;
  reject_reason_hash: string | null;
  listing: string | null;
}

export interface Reputation {
  issued: number;
  rejected_as_issuer: number;
  cancelled: number;
  accepted_as_client: number;
  rejected_as_client: number;
  paid_on_time: number;
  paid_late: number;
}

export interface ListingView {
  invoice: InvoiceView;
  price: string;
  unpaid: string;
  discount: string;
  days_to_due: number;
  /** `null` when no client ever accepted, which is itself a signal to a buyer. */
  client_reputation: Reputation | null;
}

export class NearViewError extends Error {
  constructor(
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = "NearViewError";
  }
}

/**
 * Call a view method and decode its JSON result.
 *
 * `no-store` on purpose. Cache Components means nothing is cached unless asked, and an
 * invoice's status must never be served stale: showing "Paid" for an invoice that is not
 * is the one failure this app cannot have.
 */
export async function view<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ileri",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });

  if (!response.ok) {
    // `status`, never `statusText`: on Node 26 fetch negotiates HTTP/2, where statusText
    // is always empty, so an error built from it would say nothing.
    throw new NearViewError(`RPC returned ${response.status}`, method);
  }

  const body = await response.json();
  if (body.error) {
    throw new NearViewError(body.error.data ?? body.error.message ?? "RPC error", method);
  }
  const result = body.result;
  if (result?.error) {
    throw new NearViewError(String(result.error), method);
  }

  // The result arrives as a byte array of the JSON the method returned.
  return JSON.parse(Buffer.from(result.result).toString()) as T;
}

export function getInvoice(contractId: string, id: string) {
  return view<InvoiceView | null>(contractId, "get_invoice", { id });
}

export function getListings(contractId: string, fromIndex = "0", limit = 50) {
  return view<ListingView[]>(contractId, "get_listings", {
    from_index: fromIndex,
    limit,
  });
}

export function getListing(contractId: string, id: string) {
  return view<ListingView | null>(contractId, "get_listing", { id });
}

export function invoicesForIssuer(contractId: string, accountId: string, limit = 50) {
  return view<InvoiceView[]>(contractId, "invoices_for_issuer", {
    account_id: accountId,
    limit,
  });
}

export function invoicesForClient(contractId: string, accountId: string, limit = 50) {
  return view<InvoiceView[]>(contractId, "invoices_for_client", {
    account_id: accountId,
    limit,
  });
}

export function getReputation(contractId: string, accountId: string) {
  return view<Reputation>(contractId, "get_reputation", { account_id: accountId });
}

/**
 * Money the contract holds for an account because it could not push it.
 *
 * A payout fails when the holder is not registered on the token contract, and rather than
 * strand the money the contract credits it here for them to claim. Nothing in the app
 * would otherwise mention it, so an unregistered freelancer would see a payment vanish.
 * The dashboard asks for this on every load for exactly that reason.
 */
export function getClaimable(contractId: string, accountId: string, token: string) {
  return view<string>(contractId, "get_claimable", { account_id: accountId, token });
}

/**
 * The exact message an invite key must sign.
 *
 * Always asked of the contract rather than rebuilt here. The format binds the contract
 * id, invoice id, caller and action, and if this app and the verifier ever disagreed
 * about it every accept would fail for reasons nobody could see.
 */
export function inviteMessage(
  contractId: string,
  id: string,
  account: string,
  action: "accept" | "reject",
) {
  return view<string>(contractId, "invite_message", { id, account, action });
}

/**
 * Does `publicKey` exist as an access key on `accountId`?
 *
 * The other half of sign-in. A valid NEP-413 signature only proves somebody holds *a*
 * key; it says nothing about whose. Without this check anyone could generate a keypair,
 * sign a perfectly valid challenge, and claim to be any account they liked.
 *
 * Any access key counts, full-access or function-call. A function-call key still means
 * the wallet holds something the account granted, which is enough to prove control for
 * signing in. Permission to act on an invoice is a separate question, decided by the
 * contract against the caller's account id.
 */
export async function accountHasKey(
  accountId: string,
  publicKey: string,
): Promise<boolean> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ileri",
      method: "query",
      params: {
        request_type: "view_access_key",
        finality: "final",
        account_id: accountId,
        public_key: publicKey,
      },
    }),
  });

  if (!response.ok) {
    // Fail closed. A sign-in that cannot be verified must be refused, never waved
    // through because the network was unavailable.
    throw new NearViewError(`RPC returned ${response.status}`, "view_access_key");
  }

  const body = await response.json();
  // A missing key comes back as an error, which is the expected negative answer rather
  // than a fault. Anything else is a real problem and should not be read as "no".
  if (body.error) {
    const text = JSON.stringify(body.error);
    if (/UNKNOWN_ACCESS_KEY|does not exist|UNKNOWN_ACCOUNT/i.test(text)) return false;
    throw new NearViewError(text, "view_access_key");
  }
  return Boolean(body.result?.permission);
}
