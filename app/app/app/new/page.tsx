import { Suspense } from "react";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { ConnectWallet } from "@/components/ConnectWallet";
import { NewInvoiceForm } from "@/components/NewInvoiceForm";
import { PanelSkeleton } from "@/components/Skeleton";
import { publicEnv } from "@/lib/env";
import { currentAccount } from "@/lib/session";

export const metadata = { title: "Create an invoice — Ileri" };

export default function NewInvoicePage() {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={<AppNav accountId={null} current="invoices" />}>
        <Nav />
      </Suspense>
      <main className="mx-auto w-full max-w-[760px] flex-1 px-5 py-10">
        <Link
          href="/app"
          className="text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink"
        >
          Back to your invoices
        </Link>
        <h1 className="mt-4 font-serif text-xl leading-tight">Issue an invoice</h1>
        <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
          Only the amount, the due date and the token reach the chain. Everything else
          stays in a file encrypted in your browser, and only its hash is recorded, which
          is what proves later that nobody changed it.
        </p>
        {/* The form needs to know who is signed in, and that is runtime data, so it sits
            behind a boundary while the heading prerenders. */}
        <Suspense
          fallback={
            <div className="mt-8">
              <PanelSkeleton lines={5} label="Loading the invoice form" />
            </div>
          }
        >
          <Gate />
        </Suspense>
      </main>
    </div>
  );
}

async function Nav() {
  return <AppNav accountId={await currentAccount()} current="invoices" />;
}

async function Gate() {
  const accountId = await currentAccount();

  if (!accountId) {
    return (
      <>
        <p className="mt-3 max-w-[48ch] text-sm text-ink-soft">
          Connect a NEAR wallet first. Creating an invoice signs one transaction and
          attaches a small storage deposit, which you get back when the invoice closes.
        </p>
        <div className="mt-8">
          <ConnectWallet accountId={null} />
        </div>
      </>
    );
  }

  return (
    <NewInvoiceForm
      accountId={accountId}
      contractId={publicEnv.contractId}
      tokenId={publicEnv.tokenId}
    />
  );
}
