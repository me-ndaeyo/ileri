import { NextResponse } from "next/server";
import { OneClickError, listTokens } from "@/lib/oneclick";

/**
 * What a payer can pay with.
 *
 * Served from 1Click's own token list rather than a hardcoded set, because the chain
 * names and asset ids are theirs to change and a stale guess would offer a route that
 * cannot be quoted. The browser only ever sends back a symbol and a chain from this list,
 * and the quote route resolves those to an asset id server side.
 *
 * `/v0/tokens` is a public mainnet endpoint and reachable from anywhere, so this works on
 * testnet even though a quote does not. That is deliberate: the selector can show real
 * options and the page can explain honestly why paying through them needs mainnet.
 */

/** The ones worth offering first. Everything else is reachable but not surfaced. */
const PREFERRED = new Set(["USDC", "USDT", "ETH", "SOL", "NEAR"]);

export async function GET() {
  try {
    const tokens = await listTokens();
    const options = tokens
      .filter((token) => PREFERRED.has(token.symbol.toUpperCase()))
      .map((token) => ({
        symbol: token.symbol,
        chain: token.blockchain,
        decimals: token.decimals,
      }))
      // Stable order, so the list does not reshuffle between loads.
      .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.chain.localeCompare(b.chain));

    return NextResponse.json(
      { options },
      // The list changes rarely and a stale entry only costs one failed quote.
      { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    if (error instanceof OneClickError) {
      console.error("1Click token list failed", { error: error.message });
      return NextResponse.json({ error: "Could not reach 1Click just now" }, { status: 502 });
    }
    throw error;
  }
}
