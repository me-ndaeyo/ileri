import { NextResponse } from "next/server";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { getInvoice } from "@/lib/near";
import {
  OneClickError,
  buildQuoteRequest,
  payRoute,
  requestQuote,
  resolveAsset,
} from "@/lib/oneclick";

/** How long a quote is good for. Short, because the rate is locked for this window. */
const QUOTE_MINUTES = 10;

const Body = z.object({
  invoiceId: z.string().regex(/^\d+$/, "Not an invoice id"),
  /** What the payer holds, as 1Click names it. Resolved against /v0/tokens, never guessed. */
  originSymbol: z.string().min(1).max(20),
  originChain: z.string().min(1).max(40),
  /** An address the payer controls on the origin chain, for any refund. */
  refundTo: z.string().min(4).max(128),
});

/**
 * A quote for paying an invoice from another chain.
 *
 * Server-side because the partner JWT is server-only, and because the amount must not be
 * client-supplied. The unpaid balance is read from the contract on every request: a
 * quote built from a number the browser sent could be made to under-settle an invoice,
 * and because the route asks for an exact output, a stale balance leaves the surplus
 * stranded at an address the payer does not control.
 */
export async function POST(request: Request) {
  // 1Click has no testnet. Saying so plainly beats letting it fail inside the API with an
  // unresolvable asset id, which is what would otherwise happen here.
  if (publicEnv.network !== "mainnet") {
    return NextResponse.json(
      {
        error:
          "Paying from another chain needs mainnet. NEAR Intents has no testnet, so this " +
          "route is unavailable here. Pay with USDC on NEAR instead, which works on testnet.",
        unavailable: "no-testnet",
      },
      { status: 409 },
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Could not read that request" }, { status: 400 });
  }

  const invoice = await getInvoice(publicEnv.contractId, body.invoiceId).catch(() => null);
  if (!invoice) {
    return NextResponse.json({ error: "No such invoice" }, { status: 404 });
  }
  if (invoice.unpaid === "0") {
    return NextResponse.json(
      { error: "This invoice is settled, so there is nothing to pay" },
      { status: 409 },
    );
  }

  const route = payRoute();
  // On the native route 1Click delivers into the contract with the invoice id attached.
  // On the fallback it delivers to an account we control, which forwards it.
  const recipient =
    route === "native" ? publicEnv.contractId : process.env.RELAYER_ACCOUNT_ID;
  if (!recipient) {
    return NextResponse.json(
      { error: "The relayer route is selected but no relayer account is configured" },
      { status: 500 },
    );
  }

  try {
    const [origin, destination] = await Promise.all([
      resolveAsset(body.originSymbol, body.originChain),
      resolveAsset("USDC", "near"),
    ]);

    const quote = await requestQuote(
      buildQuoteRequest({
        originAsset: origin.assetId,
        destinationAsset: destination.assetId,
        unpaidAmount: invoice.unpaid,
        invoiceId: invoice.id,
        recipient,
        refundTo: body.refundTo,
        route,
        deadline: new Date(Date.now() + QUOTE_MINUTES * 60_000),
      }),
    );

    return NextResponse.json({
      route,
      depositAddress: quote.depositAddress ?? null,
      amountIn: quote.amountInFormatted ?? quote.amountIn ?? null,
      originSymbol: origin.symbol,
      originChain: origin.blockchain,
      // Echoed back so the page shows what the invoice will actually receive rather than
      // what the browser believed when it asked.
      settles: invoice.unpaid,
      deadline: quote.deadline ?? null,
    });
  } catch (error) {
    if (error instanceof OneClickError) {
      // The upstream status is carried through, but never its body verbatim to the
      // browser: it is a third party's text and belongs in our logs.
      console.error("1Click quote failed", { invoice: invoice.id, error: error.message });
      return NextResponse.json(
        { error: "Could not get a quote for that route just now" },
        { status: 502 },
      );
    }
    throw error;
  }
}
