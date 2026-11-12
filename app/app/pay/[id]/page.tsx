import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { PayFromAnyChain } from "@/components/PayFromAnyChain";
import { PayInvoice } from "@/components/PayInvoice";
import { PanelSkeleton, SheetSkeleton } from "@/components/Skeleton";
import { explorerBase, publicEnv } from "@/lib/env";
import { getInvoice } from "@/lib/near";
import { currentAccount } from "@/lib/session";

/**
 * Pay one invoice.
 *
 * Open to anyone with the link, because anyone may pay: the contract accepts a payment
 * from any account while the invoice is open, and a client who forwards the link to
 * their finance team should not hit a wall. Only what is already public on chain is
 * shown here. The invoice document stays encrypted and is served to entitled readers
 * from the invite page, not from this one.
 *
 * Not cached. An invoice that has just been paid must never still ask for money.
 */
export default function PayPage({ params }: PageProps<"/pay/[id]">) {
  // `params` is deliberately not awaited at the top level. Awaiting it here is runtime
  // data, which stops the shell prerendering and fails the build under Cache Components.
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex w-full max-w-[720px] flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="text-xl">
            Ileri
          </Link>
          <span className="flex-1" />
          <span className="text-xs text-ink/60">
            No account needed. You pay from your own wallet.
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-10">
        <Suspense fallback={<div className="flex flex-col gap-8"><SheetSkeleton /><PanelSkeleton lines={3} label="Loading the payment details" /></div>}>
          <Detail params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function Detail({ params }: { params: PageProps<"/pay/[id]">["params"] }) {
  const { id } = await params;
  // The cookie read sits here rather than in the shell, so the frame stays static.
  const viewer = await currentAccount();

  let invoice;
  try {
    invoice = await getInvoice(publicEnv.contractId, id);
  } catch (error) {
    return (
      <p className="border border-stamp-red/40 bg-sheet p-4 text-xs text-stamp-red">
        Could not reach the contract, so the amount due cannot be confirmed. Nothing has
        been sent. {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (!invoice) notFound();

  return (
    <>
      <h1 className="text-2xl">Pay invoice no. {invoice.id}</h1>
      <p className="mt-2 max-w-[60ch] text-sm text-ink/70">
        Issued by {invoice.issuer}. Everything below is read from the contract at{" "}
        {publicEnv.contractId}, not from our records.
      </p>

      <div className="mt-6">
        <InvoiceSheet invoice={invoice} />
      </div>

      <PayInvoice invoice={invoice} contractId={publicEnv.contractId} viewer={viewer} />

      {/* Only offered while there is something to pay. The contract returns the full
          amount on a settled invoice, so a deposit address for one would be a trap. */}
      {invoice.unpaid === "0" ? null : <PayFromAnyChain invoiceId={invoice.id} />}

      <p className="mt-6 text-xs text-ink/60">{" "}
        <a
          className="underline"
          href={`${explorerBase}/address/${publicEnv.contractId}`}
          target="_blank"
          rel="noreferrer"
        >
          Check the contract on chain
        </a>
        .
      </p>
    </>
  );
}
