import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { instrumentSvg } from "@/lib/instrument-svg";
import { getInvoice } from "@/lib/near";

/**
 * The NFT's image: the instrument, drawn from the token id.
 *
 * The contract keeps NFT metadata generic so a wallet or an explorer shows nothing
 * private, which left the row blank. This fills it without giving anything away. The
 * drawing is in `lib/instrument-svg.ts`, which has a test asserting that no account,
 * amount or date can reach it.
 *
 * Public on purpose and with no session check, because it has to be fetchable by a
 * marketplace crawler that has no cookie. Nothing here is more than the chain already
 * publishes: an invoice's status is a public view.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/nft/[id]/image.svg">) {
  const { id } = await params;
  // Checked before anything else, so a crafted id never reaches a contract call.
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "No such invoice" }, { status: 404 });
  }

  let status = "Issued";
  try {
    const invoice = await getInvoice(publicEnv.contractId, id);
    if (!invoice) {
      return NextResponse.json({ error: "No such invoice" }, { status: 404 });
    }
    status = invoice.status;
  } catch (error) {
    // An RPC that is down must not leave a marketplace with a broken image forever, so
    // the sheet is still drawn and only the stamp is withheld. The short cache below
    // means the real status arrives within the minute.
    console.error("token image: could not read status", { invoice: id, error });
    return svg(instrumentSvg({ id, contractId: publicEnv.contractId, status: "Issued" }), 30);
  }

  return svg(instrumentSvg({ id, contractId: publicEnv.contractId, status }), 60);
}

/**
 * A minute of caching, and five more while revalidating.
 *
 * The status is the only part that changes, and an invoice whose image says "accepted"
 * for a minute after it was paid is a cosmetic lag on a marketplace thumbnail. The app
 * itself never reads status from here; it reads the contract.
 */
function svg(body: string, maxAge: number): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=300`,
      // The image is inert, but it is user-reachable SVG served from our origin, so it
      // is told it may not fetch, script or frame anything.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  });
}
