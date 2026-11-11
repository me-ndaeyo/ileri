import { Suspense } from "react";
import Link from "next/link";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Amount } from "@/components/Amount";
import { StatusPill } from "@/components/StatusPill";
import { publicEnv } from "@/lib/env";
import { currentAccount } from "@/lib/session";
import { invoicesForClient, invoicesForIssuer, type InvoiceView } from "@/lib/near";

export const metadata = { title: "Your invoices — Ileri" };

/**
 * The dashboard.
 *
 * The frame is static and the account-specific part streams. Reading the session cookie
 * is runtime data, so it sits inside a Suspense boundary rather than at the top level:
 * that way the heading and the actions are prerendered and appear instantly, even though
 * who is signed in cannot be known until the request arrives.
 */
export default function Dashboard() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-10">
      <h1 className="text-lg">Your invoices</h1>
      <Suspense fallback={<p className="mt-8 text-xs text-ink/60">Loading…</p>}>
        <SignedInArea />
      </Suspense>
    </main>
  );
}

async function SignedInArea() {
  const accountId = await currentAccount();

  if (!accountId) {
    return (
      <>
        <p className="mt-3 max-w-[48ch] text-sm text-ink/70">
          Connect a NEAR wallet to see the invoices you have sent and received. Signing in
          costs nothing and sends no transaction.
        </p>
        <div className="mt-8">
          <ConnectWallet accountId={null} />
        </div>
      </>
    );
  }

  // Both reads are independent, so they go together rather than one after the other.
  const [sent, received] = await Promise.all([
    invoicesForIssuer(publicEnv.contractId, accountId).catch(() => null),
    invoicesForClient(publicEnv.contractId, accountId).catch(() => null),
  ]);

  return (
    <>
      <div className="mt-2">
        <ConnectWallet accountId={accountId} />
      </div>

      <div className="mt-8 flex gap-3">
        <Link
          href="/app/new"
          className="border border-stamp-blue bg-stamp-blue px-4 py-2 text-sm text-sheet hover:opacity-90"
        >
          Create an invoice
        </Link>
        <Link href="/market" className="border border-rule px-4 py-2 text-sm hover:bg-paper">
          Browse the market
        </Link>
      </div>

      <Section title="Sent" invoices={sent} empty="You have not sent an invoice yet." />
      <Section
        title="Received"
        invoices={received}
        empty="Nothing has been billed to you yet."
      />
    </>
  );
}

function Section({
  title,
  invoices,
  empty,
}: {
  title: string;
  invoices: InvoiceView[] | null;
  empty: string;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-base">{title}</h2>
      {/* `null` means the read failed, which is not the same as having none. Saying
          "nothing here" after a network error would be a lie. */}
      {invoices === null ? (
        <p className="mt-3 border border-stamp-red/40 bg-sheet p-4 text-xs text-stamp-red">
          Could not reach the contract just now.
        </p>
      ) : invoices.length === 0 ? (
        <p className="mt-3 border border-rule bg-sheet p-4 text-xs text-ink/60">{empty}</p>
      ) : (
        <ul className="mt-3 border-t border-rule">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="border-b border-rule bg-sheet">
              <Link
                href={`/app/invoice/${invoice.id}`}
                className="flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-paper"
              >
                <span className="text-sm">Invoice {invoice.id}</span>
                <span className="flex items-baseline gap-3 text-xs">
                  <Amount value={invoice.amount} symbol="USDC" />
                  <StatusPill status={invoice.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
