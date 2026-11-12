import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AcceptInvoice } from "@/components/AcceptInvoice";
import { PanelSkeleton, SheetSkeleton } from "@/components/Skeleton";
import { publicEnv } from "@/lib/env";
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
 * Works signed out: somebody who has never used NEAR should be able to read the invoice
 * before being asked to connect anything. The invite key is handled entirely in the
 * browser, so none of it reaches this server component.
 */
export default function InvitePage({ params }: PageProps<"/i/[id]">) {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-10">
      <h1 className="text-lg">An invoice for you</h1>
      <Suspense fallback={<div className="mt-6 flex flex-col gap-8"><SheetSkeleton /><PanelSkeleton lines={3} label="Loading the invoice" /></div>}>
        <Review params={params} />
      </Suspense>
    </main>
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
    <AcceptInvoice
      invoice={invoice}
      accountId={accountId}
      contractId={publicEnv.contractId}
    />
  );
}
