import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/Amount";
import { AppNav } from "@/components/AppNav";
import { BuyInvoice } from "@/components/BuyInvoice";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { PanelSkeleton, SheetSkeleton } from "@/components/Skeleton";
import { explorerBase, publicEnv } from "@/lib/env";
import { getInvoice, getListing, type ListingView } from "@/lib/near";
import { annualisedDiscount, discountPercent } from "@/lib/money";
import { currentAccount } from "@/lib/session";

/**
 * One listing, in enough detail to decide whether to buy it, and the buy itself.
 *
 * Not cached: a listing that has just been bought must not still look available.
 */
export default function ListingPage({ params }: PageProps<"/market/[id]">) {
  // `params` is deliberately not awaited here. Awaiting it at the top level is runtime
  // data, which stops the shell prerendering and fails the build under Cache Components.
  // Pushing the await into the suspended child keeps the frame static and streams only
  // the part that genuinely depends on the URL.
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={<AppNav accountId={null} current="market" />}>
        <Nav />
      </Suspense>
      <main className="mx-auto w-full max-w-[760px] flex-1 px-5 py-10">
        <Link
          href="/market"
          className="text-sm text-ink/60 underline decoration-rule underline-offset-4 hover:text-ink"
        >
          Back to the market
        </Link>
        <Suspense
          fallback={
            <div className="mt-6 flex flex-col gap-8">
              <SheetSkeleton />
              <PanelSkeleton lines={4} label="Loading the listing" />
            </div>
          }
        >
          <Detail params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function Nav() {
  return <AppNav accountId={await currentAccount()} current="market" />;
}

async function Detail({ params }: { params: PageProps<"/market/[id]">["params"] }) {
  const { id } = await params;
  // The cookie read happens here rather than in the page shell, so the frame still
  // prerenders under Cache Components.
  const viewer = await currentAccount();
  let listing: ListingView | null;
  try {
    listing = await getListing(publicEnv.contractId, id);
  } catch (error) {
    return (
      <p className="mt-6 border border-stamp-red/40 bg-sheet p-4 text-xs text-stamp-red">
        Could not reach the contract. {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }

  // "Not for sale" and "does not exist" are different answers and deserve different
  // pages. Telling somebody an invoice could not be found when it plainly exists, and is
  // simply not listed, would be a lie. There is nothing to protect by conflating them
  // either: invoices are public on chain.
  if (!listing) {
    const invoice = await getInvoice(publicEnv.contractId, id);
    if (!invoice) notFound();
    return (
      <div className="mt-6">
        <p className="border border-rule bg-sheet p-4 text-xs text-ink/60">
          Invoice {id} is not for sale. Its holder has not listed it, or it has already
          been bought or paid.
        </p>
        <div className="mt-6">
          <InvoiceSheet invoice={invoice} />
        </div>
      </div>
    );
  }

  const { invoice, price, unpaid, days_to_due, client_reputation } = listing;
  const percent = discountPercent(unpaid, price);
  const annual = annualisedDiscount(unpaid, price, days_to_due);

  return (
    <div className="mt-6">
      <InvoiceSheet invoice={invoice} />

      <section className="mt-8 border border-rule bg-sheet">
        <h2 className="border-b border-rule px-5 py-3 text-base">What you are buying</h2>
        <dl>
          <Line label="Price you pay now">
            <Amount value={price} symbol="USDC" />
          </Line>
          <Line label="What you collect">
            <Amount value={unpaid} symbol="USDC" />
          </Line>
          <Line label="Your margin">
            <Amount value={listing.discount} symbol="USDC" />
            <span className="text-ink/60"> · {percent.toFixed(1)}%</span>
          </Line>
          <Line label="As a yearly rate">
            {annual === null ? (
              <span className="text-ink/60">Past due, so no annual rate</span>
            ) : (
              <>
                {annual.toFixed(0)}% a year
                <span className="text-ink/60"> over {days_to_due} days</span>
              </>
            )}
          </Line>
        </dl>
      </section>

      <section className="mt-6 border border-rule bg-sheet">
        <h2 className="border-b border-rule px-5 py-3 text-base">Who owes it</h2>
        {client_reputation ? (
          <dl>
            <Line label="Paid on time">{client_reputation.paid_on_time}</Line>
            <Line label="Paid late">{client_reputation.paid_late}</Line>
            <Line label="Invoices accepted">{client_reputation.accepted_as_client}</Line>
            <Line label="Invoices rejected">{client_reputation.rejected_as_client}</Line>
          </dl>
        ) : (
          <p className="px-5 py-4 text-xs text-ink/60">
            No record. This invoice was never accepted by a signed-in client, so there is
            no payment history to judge it by.
          </p>
        )}
      </section>

      <BuyInvoice listing={listing} contractId={publicEnv.contractId} viewer={viewer} />

      <p className="mt-6 text-xs text-ink/60">
        Payments on this invoice go to whoever holds it, so after buying, the rest is paid
        to you.{" "}
        <a
          className="underline"
          href={`${explorerBase}/address/${publicEnv.contractId}`}
          target="_blank"
          rel="noreferrer"
        >
          Check it on chain
        </a>
        .
      </p>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule px-5 py-2.5 last:border-0">
      <dt className="text-xs text-ink/60">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
