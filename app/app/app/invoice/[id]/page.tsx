import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/Amount";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { InvoiceActions, type Roles } from "@/components/InvoiceActions";
import { explorerBase, publicEnv } from "@/lib/env";
import { getInvoice } from "@/lib/near";
import { mayReadDocument, readDocument } from "@/lib/invoice-file";
import type { InvoiceDocument } from "@/lib/invoice";
import { currentAccount } from "@/lib/session";

export const metadata = { title: "Invoice — Ileri" };

/**
 * One invoice, for the people party to it.
 *
 * Shows the document to the issuer, the bound client and the current holder, and offers
 * only the actions that viewer can actually take.
 */
export default function InvoicePage({ params }: PageProps<"/app/invoice/[id]">) {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-10">
      <Link href="/app" className="text-xs text-ink/60 hover:text-ink">
        Back to your invoices
      </Link>
      <Suspense fallback={<p className="mt-6 text-xs text-ink/60">Loading invoice…</p>}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: { params: PageProps<"/app/invoice/[id]">["params"] }) {
  const { id } = await params;
  const [invoice, accountId] = await Promise.all([
    getInvoice(publicEnv.contractId, id).catch(() => null),
    currentAccount(),
  ]);

  if (!invoice) notFound();

  if (!accountId) {
    return (
      <p className="mt-6 border border-rule bg-sheet p-4 text-sm text-ink/70">
        Sign in to see this invoice.{" "}
        <Link href="/app" className="underline">
          Go to your invoices
        </Link>
        .
      </p>
    );
  }

  const roles: Roles = {
    isIssuer: accountId === invoice.issuer,
    isHolder: accountId === invoice.holder,
    isClient: accountId === invoice.client,
  };

  // Same 404 as a missing invoice for anybody with no part in it: confirming an invoice
  // exists but is not theirs tells an enumerator something.
  if (!roles.isIssuer && !roles.isHolder && !roles.isClient) notFound();

  let document: InvoiceDocument | null = null;
  let documentProblem: string | null = null;
  if (mayReadDocument(invoice, accountId, null)) {
    const result = await readDocument(invoice).catch(() => ({ denied: "no-document" }) as const);
    if ("document" in result) {
      document = JSON.parse(result.document) as InvoiceDocument;
    } else if (result.denied === "hash-mismatch") {
      // Worth saying loudly: the stored file is not the one this invoice was minted for.
      documentProblem =
        "The stored details do not match what is on chain, so they are not shown.";
    } else {
      documentProblem = "The details for this invoice are not stored here.";
    }
  }

  return (
    <div className="mt-6">
      <InvoiceSheet invoice={invoice}>
        {document ? (
          <dl>
            {document.lines.map((line, index) => (
              <div
                key={index}
                className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-0"
              >
                <dt className="text-sm">{line.description}</dt>
                <dd className="text-sm tabular">
                  <Amount value={line.amount} />
                </dd>
              </div>
            ))}
            {document.notes ? (
              <p className="pt-3 text-xs text-ink/70">{document.notes}</p>
            ) : null}
          </dl>
        ) : (
          <p className="text-xs text-ink/60">{documentProblem}</p>
        )}
      </InvoiceSheet>

      <section className="mt-8">
        <h2 className="text-base">What happened</h2>
        {/* Built from the invoice's own timestamps rather than from indexed events. The
            contract emits NEP-297 events, but reading them needs an indexer, and the
            timestamps already answer the question a human is asking. */}
        <ol className="mt-3 border-t border-rule">
          <Event when={invoice.created_at} what={`Issued by ${invoice.issuer}`} />
          {invoice.accepted_at ? (
            <Event
              when={invoice.accepted_at}
              what={
                invoice.client
                  ? `Accepted by ${invoice.client}`
                  : "Paid in full before anyone accepted it"
              }
            />
          ) : null}
          {invoice.paid_at ? <Event when={invoice.paid_at} what="Paid in full" /> : null}
          {invoice.stored_status === "Rejected" ? (
            <Event when={invoice.created_at} what="Rejected" muted />
          ) : null}
          {invoice.stored_status === "Cancelled" ? (
            <Event when={invoice.created_at} what="Cancelled by the issuer" muted />
          ) : null}
        </ol>
      </section>

      {invoice.listing ? (
        <p className="mt-6 border border-stamp-blue/40 bg-sheet p-3 text-xs">
          For sale at <Amount value={invoice.listing} symbol="USDC" />.{" "}
          <Link href={`/market/${invoice.id}`} className="underline">
            See the listing
          </Link>
        </p>
      ) : null}

      <section className="mt-8 border-t border-rule pt-6">
        <InvoiceActions invoice={invoice} roles={roles} contractId={publicEnv.contractId} />
      </section>

      <p className="mt-8 flex flex-wrap gap-4 text-xs text-ink/60">
        <Link href={`/pay/${invoice.id}`} className="underline">
          Payment link to share
        </Link>
        <a
          href={`${explorerBase}/txns?a=${publicEnv.contractId}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Check it on chain
        </a>
      </p>
    </div>
  );
}

function Event({
  when,
  what,
  muted,
}: {
  when: string;
  what: string;
  muted?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule bg-sheet px-4 py-2.5">
      <span className={`text-sm ${muted ? "text-ink/60" : ""}`}>{what}</span>
      <time className="text-xs text-ink/60">{formatMoment(when)}</time>
    </li>
  );
}

/** Nanoseconds to something a person reads. */
function formatMoment(ns: string): string {
  return new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
