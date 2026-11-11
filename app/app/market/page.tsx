import { Suspense } from "react";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { StatusPill } from "@/components/StatusPill";
import { publicEnv } from "@/lib/env";
import { getListings, type ListingView } from "@/lib/near";
import { annualisedDiscount, discountPercent } from "@/lib/money";

export const metadata = { title: "Market — Ileri" };

/**
 * Invoices for sale.
 *
 * Deliberately not wrapped in `use cache`. A listing's price and unpaid balance change
 * the moment somebody pays or buys, and showing a sold invoice as available would send a
 * buyer's money at something that no longer exists. Cache Components makes caching
 * opt-in, so the default here is exactly right: fetched per request, inside a Suspense
 * boundary so the shell still prerenders.
 */
export default function MarketPage() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-10">
      <h1 className="text-lg">Market</h1>
      <p className="mt-2 max-w-[52ch] text-xs text-ink/60">
        Invoices their current holder wants to sell before the due date. You are buying
        the unpaid balance, at a discount that prices the risk the client never pays.
      </p>

      <Suspense fallback={<Skeleton />}>
        <Listings />
      </Suspense>
    </main>
  );
}

async function Listings() {
  let listings: ListingView[];
  try {
    listings = await getListings(publicEnv.contractId);
  } catch (error) {
    // The public RPC drops requests under load, and an empty table would wrongly say
    // "nothing for sale". Say what actually happened instead.
    return (
      <p className="mt-8 border border-stamp-red/40 bg-sheet p-4 text-xs text-stamp-red">
        Could not reach the contract just now. {String(error instanceof Error ? error.message : error)}
      </p>
    );
  }

  if (listings.length === 0) {
    return (
      <p className="mt-8 border border-rule bg-sheet p-4 text-xs text-ink/60">
        Nothing is for sale right now.
      </p>
    );
  }

  return (
    <ul className="mt-8 border-t border-rule">
      {listings.map((listing) => (
        <Row key={listing.invoice.id} listing={listing} />
      ))}
    </ul>
  );
}

function Row({ listing }: { listing: ListingView }) {
  const { invoice, price, unpaid, days_to_due, client_reputation } = listing;
  const percent = discountPercent(unpaid, price);
  const annual = annualisedDiscount(unpaid, price, days_to_due);

  return (
    <li className="border-b border-rule bg-sheet">
      <Link href={`/market/${invoice.id}`} className="block px-4 py-4 hover:bg-paper">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-base">Invoice {invoice.id}</span>
          <StatusPill status={invoice.status} />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <Field label="Price">
            <Amount value={price} symbol="USDC" />
          </Field>
          <Field label="You collect">
            <Amount value={unpaid} symbol="USDC" />
          </Field>
          <Field label="Discount">
            {percent.toFixed(1)}%
            {annual === null ? null : (
              <span className="text-ink/60"> · {annual.toFixed(0)}% a year</span>
            )}
          </Field>
          <Field label="Due">
            {days_to_due > 0 ? `in ${days_to_due} days` : "past due"}
          </Field>
        </dl>

        <p className="mt-3 text-xs text-ink/60">
          {/* A missing record is itself the signal: nobody signed for this invoice. */}
          {client_reputation
            ? `Client: ${client_reputation.paid_on_time} paid on time, ${client_reputation.paid_late} late`
            : "No client history, this invoice was never accepted by a signed-in client"}
        </p>
      </Link>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink/60">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-8 border-t border-rule">
      {[0, 1].map((i) => (
        <div key={i} className="border-b border-rule bg-sheet px-4 py-4">
          <div className="h-4 w-32 animate-pulse bg-rule" />
          <div className="mt-3 h-3 w-full animate-pulse bg-rule" />
        </div>
      ))}
    </div>
  );
}
