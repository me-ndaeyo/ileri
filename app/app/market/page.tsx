import { Suspense } from "react";
import Link from "next/link";
import { AccountChip } from "@/components/AccountChip";
import { Amount } from "@/components/Amount";
import { AppNav } from "@/components/AppNav";
import { LedgerSkeleton } from "@/components/Skeleton";
import { StatusPill } from "@/components/StatusPill";
import { publicEnv } from "@/lib/env";
import { annualisedDiscount, discountPercent, formatAmount, sum } from "@/lib/money";
import { getListings, type ListingView } from "@/lib/near";
import { currentAccount } from "@/lib/session";

export const metadata = { title: "Market — Ileri" };

/**
 * Invoices for sale.
 *
 * Deliberately not wrapped in `use cache`. A listing's price and unpaid balance change
 * the moment somebody pays or buys, and showing a sold invoice as available would send a
 * buyer's money at something that no longer exists. Cache Components makes caching
 * opt-in, so the default here is exactly right: fetched per request, inside a Suspense
 * boundary so the shell still prerenders.
 *
 * The risk notice is at the top rather than in small print at the bottom. There is no
 * recourse on a purchase, and somebody deciding to spend money should read that before
 * the returns, not after.
 */
export default function MarketPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={<AppNav accountId={null} current="market" />}>
        <Nav />
      </Suspense>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-5 py-10">
        <Suspense
          fallback={
            <>
              <h1 className="font-serif text-xl leading-tight">Invoices for sale</h1>
              <div className="mt-8">
                <LedgerSkeleton rows={3} label="Loading invoices for sale" />
              </div>
            </>
          }
        >
          <Listings />
        </Suspense>
      </main>
    </div>
  );
}

async function Nav() {
  return <AppNav accountId={await currentAccount()} current="market" />;
}

async function Listings() {
  let listings: ListingView[];
  try {
    listings = await getListings(publicEnv.contractId);
  } catch (error) {
    // The public RPC drops requests under load, and an empty table would wrongly say
    // "nothing for sale". Say what actually happened instead.
    return (
      <>
        <h1 className="font-serif text-xl leading-tight">Invoices for sale</h1>
        <p className="mt-6 border border-stamp-red/40 bg-sheet p-4 text-xs text-stamp-red">
          Could not reach the contract just now, so no listings are shown rather than
          shown wrong.{" "}
          {String(error instanceof Error ? error.message : error)}
        </p>
      </>
    );
  }

  const onOffer = sum(listings.map((l) => l.unpaid));

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <h1 className="font-serif text-xl leading-tight">Invoices for sale</h1>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-ink/70">
            {listings.length === 0
              ? "Nothing is listed right now."
              : `${listings.length} accepted ${listings.length === 1 ? "invoice" : "invoices"}, each listed below what is still owed on it. Buy one and you become the party the client pays.`}
          </p>
        </div>
        {listings.length > 0 ? (
          <>
            <span className="flex-1" />
            <div className="text-right">
              <p className="text-xs text-ink/60">Unpaid on offer</p>
              <p className="mt-1 flex items-baseline justify-end gap-2">
                <span className="tabular text-lg">{formatAmount(onOffer)}</span>
                <span className="font-mono text-xs text-ink/60">USDC</span>
              </p>
            </div>
          </>
        ) : null}
      </div>

      {listings.length === 0 ? (
        <p className="mt-8 border border-rule bg-sheet p-4 text-sm text-ink/60">
          When a holder lists an invoice below its unpaid balance, it appears here. If you
          hold one,{" "}
          <Link href="/app" className="underline decoration-rule underline-offset-2">
            list it from its own page
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="mt-8 border border-stamp-red bg-sheet px-5 py-4">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-stamp-red">
                There is no recourse here.
              </span>
              <span className="min-w-0 flex-[1_1_28rem] text-sm leading-relaxed text-ink/70">
                If a client never pays, whoever holds the invoice carries the loss. Nothing
                is insured, a purchase cannot be reversed, and Ileri takes no fee and no
                position. The client&apos;s record is the only thing to go on.
              </span>
            </p>
          </div>

          <ul className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-5">
            {listings.map((listing) => (
              <Card key={listing.invoice.id} listing={listing} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * One listing, as a cut stub of the instrument.
 *
 * The four figures are the whole decision: what you pay, what you collect, the gap, and
 * how long you wait for it. The client's record sits under them because it is what the
 * gap is pricing.
 */
function Card({ listing }: { listing: ListingView }) {
  const { invoice, price, unpaid, discount, days_to_due, client_reputation } = listing;
  const percent = discountPercent(unpaid, price);
  const annual = annualisedDiscount(unpaid, price, days_to_due);
  const late = client_reputation ? client_reputation.paid_late : 0;

  return (
    <li>
      <Link
        href={`/market/${invoice.id}`}
        className="flex h-full flex-col border border-gold bg-sheet hover:bg-paper"
      >
        <span className="band h-4 w-full" aria-hidden="true" />

        <span className="flex items-start justify-between gap-4 px-5 pt-4">
          <span>
            <span className="serial block text-xs">
              No. {invoice.id.padStart(10, "0")}
            </span>
            <span className="mt-1.5 block">
              {invoice.client ? (
                <AccountChip accountId={invoice.client} />
              ) : (
                <span className="text-xs text-ink/60 italic">no client bound</span>
              )}
            </span>
          </span>
          <StatusPill status={invoice.status} />
        </span>

        <span className="block px-5 pt-4">
          <span className="block text-xs text-ink/60">Asking price</span>
          <span className="mt-1 flex items-baseline gap-2">
            <span className="tabular font-serif text-lg leading-none">
              {formatAmount(price)}
            </span>
            <span className="font-mono text-xs text-ink/60">USDC</span>
          </span>
        </span>

        <span className="mt-4 block px-5">
          <Line label="You collect">
            <Amount value={unpaid} />
          </Line>
          <Line label="Your return">
            <span className="text-stamp-green">
              <Amount value={discount} /> · {percent.toFixed(1)}%
            </span>
          </Line>
          <Line label="You wait">
            {days_to_due > 0 ? `${days_to_due} days` : "it is past due"}
            {annual === null ? null : (
              <span className="text-ink/60"> · {annual.toFixed(0)}% a year</span>
            )}
          </Line>
          <Line label="Client's record" last>
            {/* A missing record is itself the signal: nobody signed for this invoice. */}
            {client_reputation ? (
              <span className={late > 0 ? "text-stamp-red" : "text-stamp-green"}>
                {client_reputation.paid_on_time} on time, {late} late
              </span>
            ) : (
              <span className="text-ink/60">never accepted by a signed-in client</span>
            )}
          </Line>
        </span>

        <span className="flex-1" />
        <span className="comb mt-4 block" aria-hidden="true" />
      </Link>
    </li>
  );
}

function Line({
  label,
  last,
  children,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`flex items-baseline justify-between gap-4 py-2 text-xs ${
        last ? "" : "border-b border-rule"
      }`}
    >
      <span className="text-ink/60">{label}</span>
      <span className="tabular">{children}</span>
    </span>
  );
}
