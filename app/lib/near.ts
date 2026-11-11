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
