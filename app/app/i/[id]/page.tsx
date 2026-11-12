import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcceptInvoice } from "@/components/AcceptInvoice";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PanelSkeleton, SheetSkeleton } from "@/components/Skeleton";
import { publicEnv } from "@/lib/env";
import { formatAmount } from "@/lib/money";
import { getInvoice } from "@/lib/near";
import { currentAccount } from "@/lib/session";

export const metadata = {
  title: "An invoice for you — Ileri",
  // The key lives in the fragment, which is never sent to a server, but a search engine
  // indexing this page would be pointless and the URL is meant to be private anyway.
  robots: { index: false, follow: false },
};

/**
 * The page a client lands on from an invite link.
 *
 * The one screen in the app whose reader may never have touched crypto, and may have
 * arrived from an email with no idea what Ileri is. So it leads with the fact they care
 * about, which is who is asking them for how much, and says plainly that reading costs
 * nothing and needs no wallet.
 *
 * Works signed out. The invite key is handled entirely in the browser, so none of it
 * reaches this server component.
 */
export default function InvitePage({ params }: PageProps<"/i/[id]">) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-rule bg-sheet">
        <div className="mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="mark h-7 w-7 flex-none" aria-hidden="true" />
            <span className="font-serif text-base leading-none">Ileri</span>
          </Link>
          <span className="flex-1" />
          <ThemeToggle />
          <span className="flex items-center gap-2 text-xs text-ink/60">
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-stamp-green" />
            Opened with a private link. The key stayed in your browser.
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[760px] flex-1 px-5 py-10">
        <Suspense
          fallback={
            <div className="flex flex-col gap-8">
              <PanelSkeleton lines={2} label="Loading the invoice" />
              <SheetSkeleton />
            </div>
          }
        >
          <Review params={params} />
        </Suspense>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto w-full max-w-[760px] px-5 py-6">
          <p className="max-w-[68ch] text-xs leading-relaxed text-ink/60">
            Accepting records on chain that you agreed to this invoice. Your account id,
            the amount, the due date and the status become public. Your name, the line
            items and any notes stay in an encrypted file that only you, the issuer and
            whoever holds the invoice can open.
          </p>
        </div>
      </footer>
    </div>
  );
}

async function Review({ params }: { params: PageProps<"/i/[id]">["params"] }) {
  const { id } = await params;
  const [invoice, accountId] = await Promise.all([
    getInvoice(publicEnv.contractId, id).catch(() => null),
    currentAccount(),
  ]);

  if (!invoice) notFound();

  return (
    <>
      <h1 className="max-w-[26ch] font-serif text-xl leading-tight text-balance">
        {invoice.issuer} sent you an invoice for {formatAmount(invoice.amount)} USDC
      </h1>
      <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-ink/70">
        Read it, then accept it or send it back. Accepting makes it binding and lets the
        issuer sell it to a buyer, who would then be the one you pay. You need a NEAR
        wallet to accept. You do not need one to read this, and a payment in full counts as
        acceptance on its own.
      </p>

      <AcceptInvoice
        invoice={invoice}
        accountId={accountId}
        contractId={publicEnv.contractId}
      />
    </>
  );
}
