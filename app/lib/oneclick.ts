/**
 * NEAR Intents 1Click, for paying an invoice from a chain other than NEAR.
 *
 * Server-only. The partner JWT must never reach the browser, and without it every quote
 * carries a 0.2% fee.
 *
 * **1Click is mainnet only. There is no testnet.** So this cannot be exercised against
 * `ileri.testnet` at all, and until a mainnet check has run with about a dollar, treat
 * every path through this file as written and unverified. That is why the request builder
 * is a pure function with its own tests: the shape of the request is the part we can be
 * sure of without spending anything.
 *
 * Two routes, chosen by `PAY_ROUTE`:
 *
 * - `native` sends 1Click at the invoice contract directly, with `customRecipientMsg`
 *   carrying the invoice id, so delivery arrives as `ft_transfer_call` and the contract's
 *   `ft_on_transfer` settles the invoice in one step. Upstream marks that field "HIGHLY
 *   EXPERIMENTAL" and warns that funds are lost if the recipient lacks `ft_on_transfer`
 *   or a storage deposit. Both are true of our contract, which is exactly what the
 *   mainnet check is for.
 * - `relay` sends it at an account we control, which then calls `ft_transfer_call`
 *   itself. Briefly custodial, and the fallback if the native route does not hold.
 *
 * Everything except the final hop is identical between them, which is the point: the
 * route is one field and one extra job, not a second implementation.
 */

const BASE = "https://1click.chaindefuser.com/v0";

/** Which delivery route is in use. Defaults to the better story, not the safer one. */
export type PayRoute = "native" | "relay";

export function payRoute(): PayRoute {
  return process.env.PAY_ROUTE === "relay" ? "relay" : "native";
}

export class OneClickError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OneClickError";
  }
}

/** One entry of `GET /v0/tokens`, trimmed to what we use. */
export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
}

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  deadline: string;
  customRecipientMsg?: string;
}

export interface Quote {
  depositAddress?: string;
  amountIn?: string;
  amountInFormatted?: string;
  amountOut?: string;
  deadline?: string;
  timeWhenInactive?: string;
}

/**
 * Build the quote body. Pure, so it can be tested without spending anything.
 *
 * `EXACT_OUTPUT` is not a preference, it is a requirement. NEP-141 refunds an unapplied
 * amount to the `sender_id` of the transfer, and on this route that sender is an Intents
 * contract rather than the person paying. So any excess would land somewhere the payer
 * cannot reach it. Asking for an exact output is what keeps the excess at zero.
 *
 * For the same reason the caller must quote against the invoice's **live** unpaid
 * balance: if somebody part-pays between the quote and the delivery, the surplus is
 * stranded.
 */
export function buildQuoteRequest({
  originAsset,
  destinationAsset,
  unpaidAmount,
  invoiceId,
  recipient,
  refundTo,
  route,
  deadline,
  dry = false,
  slippageTolerance = 100,
}: {
  originAsset: string;
  destinationAsset: string;
  /** The invoice's unpaid balance, in the token's smallest units. */
  unpaidAmount: string;
  invoiceId: string;
  /** The contract on the native route, the relayer account on the fallback. */
  recipient: string;
  /** An address the payer controls on the origin chain. */
  refundTo: string;
  route: PayRoute;
  deadline: Date;
  dry?: boolean;
  slippageTolerance?: number;
}): QuoteRequest {
  if (!/^\d+$/.test(unpaidAmount) || unpaidAmount === "0") {
    throw new OneClickError(`Not an amount to quote for: ${JSON.stringify(unpaidAmount)}`);
  }
  if (!/^\d+$/.test(invoiceId)) {
    throw new OneClickError(`Not an invoice id: ${JSON.stringify(invoiceId)}`);
  }

  const request: QuoteRequest = {
    dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance,
    originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset,
    amount: unpaidAmount,
    recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline: deadline.toISOString(),
  };

  // Only the native route asks 1Click to deliver with `ft_transfer_call`. On the relay
  // route the money arrives as a plain transfer and our own account carries the message,
  // so sending this field would be meaningless at best.
  if (route === "native") {
    request.customRecipientMsg = JSON.stringify({
      action: "pay",
      invoice_id: invoiceId,
    });
  }

  return request;
}

function headers(): HeadersInit {
  const base: Record<string, string> = { "content-type": "application/json" };
  const jwt = process.env.ONECLICK_JWT;
  // Optional: without it quotes still work and carry a 0.2% fee.
  if (jwt) base.authorization = `Bearer ${jwt}`;
  return base;
}

/**
 * Errors report `response.status`, never `response.statusText`.
 *
 * On Node 26 the built-in fetch negotiates HTTP/2, and HTTP/2 has no status text, so
 * `statusText` is an empty string. Reading it would give blank error messages in
 * production that do not reproduce locally.
 */
async function failure(response: Response, what: string): Promise<OneClickError> {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 400);
  } catch {
    detail = "(no body)";
  }
  return new OneClickError(`1Click ${what} failed with ${response.status}: ${detail}`, response.status);
}

export async function listTokens(): Promise<OneClickToken[]> {
  const response = await fetch(`${BASE}/tokens`, {
    headers: headers(),
    // Asset ids change rarely, and a stale list would quote against a delisted asset.
    next: { revalidate: 300 },
  });
  if (!response.ok) throw await failure(response, "tokens");
  return (await response.json()) as OneClickToken[];
}

/**
 * Find an asset id by symbol and chain.
 *
 * Never hardcoded. The ids look like `nep141:base-0x833589f…omft.near` and a wrong one
 * does not fail loudly, it sends real money to the wrong asset. Asking the API is the
 * only way to be right.
 */
export async function resolveAsset(symbol: string, blockchain: string): Promise<OneClickToken> {
  const tokens = await listTokens();
  const match = tokens.find(
    (token) =>
      token.symbol.toLowerCase() === symbol.toLowerCase() &&
      token.blockchain.toLowerCase() === blockchain.toLowerCase(),
  );
  if (!match) {
    throw new OneClickError(`1Click does not list ${symbol} on ${blockchain}`);
  }
  return match;
}

export async function requestQuote(request: QuoteRequest): Promise<Quote> {
  const response = await fetch(`${BASE}/quote`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(request),
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, "quote");
  return (await response.json()) as Quote;
}

/**
 * Where a deposit has got to.
 *
 * Only ever used to tell somebody what is happening. It is never the source of truth for
 * whether an invoice is paid: that is the contract's `paid`, and this saying "success"
 * while the contract disagrees means the delivery did not settle, which is precisely the
 * failure the native route has to be checked for.
 */
export async function fetchStatus(depositAddress: string): Promise<unknown> {
  const url = `${BASE}/status?depositAddress=${encodeURIComponent(depositAddress)}`;
  const response = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw await failure(response, "status");
  return await response.json();
}
