import { Suspense } from "react";
import Link from "next/link";
import { ConnectWallet } from "@/components/ConnectWallet";
import { NewInvoiceForm } from "@/components/NewInvoiceForm";
import { PanelSkeleton } from "@/components/Skeleton";
import { publicEnv } from "@/lib/env";
import { currentAccount } from "@/lib/session";

export const metadata = { title: "Create an invoice — Ileri" };

export default function NewInvoicePage() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-10">
      <Link href="/app" className="text-xs text-ink/60 hover:text-ink">
        Back to your invoices
      </Link>
      <h1 className="mt-4 text-lg">Create an invoice</h1>
      {/* The form needs to know who is signed in, and that is runtime data, so it sits
          behind a boundary while the heading prerenders. */}
      <Suspense fallback={<div className="mt-8"><PanelSkeleton lines={5} label="Loading the invoice form" /></div>}>
        <Gate />
      </Suspense>
    </main>
  );
}

async function Gate() {
  const accountId = await currentAccount();

  if (!accountId) {
    return (
      <>
        <p className="mt-3 max-w-[48ch] text-sm text-ink/70">
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
