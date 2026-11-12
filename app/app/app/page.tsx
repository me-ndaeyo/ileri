import { Suspense } from "react";
import Link from "next/link";
import { AccountChip } from "@/components/AccountChip";
import { Amount } from "@/components/Amount";
import { AppNav } from "@/components/AppNav";
import { ClaimPayout } from "@/components/ClaimPayout";
import { ConnectWallet } from "@/components/ConnectWallet";
import { LedgerSkeleton } from "@/components/Skeleton";
import { StatusPill } from "@/components/StatusPill";
import { publicEnv } from "@/lib/env";
import { formatAmount, sum, unpaid } from "@/lib/money";
import {
  getClaimable,
  invoicesForClient,
  invoicesForIssuer,
  type InvoiceView,
} from "@/lib/near";
import { currentAccount } from "@/lib/session";

export const metadata = { title: "Your invoices — Ileri" };

/**
 * The dashboard, as a ledger.
 *
 * The frame is static and the account-specific part streams. Reading the session cookie is
 * runtime data, so it sits inside a Suspense boundary rather than at the top level: that
 * way the heading and the nav are prerendered and appear instantly, even though who is
 * signed in cannot be known until the request arrives.
 */
export default function Dashboard() {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={<AppNav accountId={null} current="invoices" />}>
        <Nav />
      </Suspense>
      <main className="mx-auto w-full max-w-[1080px] flex-1 px-5 py-10">
        <Suspense fallback={<LedgerSkeleton rows={4} />}>
          <SignedInArea />
        </Suspense>
      </main>
    </div>
  );
}

async function Nav() {
  return <AppNav accountId={await currentAccount()} current="invoices" />;
}

async function SignedInArea() {
  const accountId = await currentAccount();

  if (!accountId) {
    return (
      <div className="max-w-[52ch]">
        <h1 className="font-serif text-xl leading-tight">Your invoices</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink/70">
          Connect a NEAR wallet to see the invoices you have sent and received. Signing in
          costs nothing and sends no transaction: your wallet signs a message, not a
          transfer.
        </p>
        <div className="mt-6">
          <ConnectWallet accountId={null} />
        </div>
      </div>
    );
  }

  // All three reads are independent, so they go together rather than one after another.
  const [sent, received, claimable] = await Promise.all([
    invoicesForIssuer(publicEnv.contractId, accountId).catch(() => null),
    invoicesForClient(publicEnv.contractId, accountId).catch(() => null),
    getClaimable(publicEnv.contractId, accountId, publicEnv.tokenId).catch(() => "0"),
  ]);

  const mine = sent ?? [];
  const owed = mine.filter((i) => i.stored_status !== "Paid" && i.unpaid !== "0");
  const overdue = owed.filter((i) => i.status === "Overdue");
  const listed = mine.filter((i) => i.listing !== null);

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <h1 className="font-serif text-xl leading-tight">Your invoices</h1>
          <p className="mt-2 text-sm text-ink/70">
            {mine.length === 0
              ? "Nothing issued yet."
              : `${mine.length} issued, read from ${publicEnv.contractId}.`}
          </p>
        </div>
        <span className="flex-1" />
        <Link
          href="/app/new"
          className="inline-flex min-h-11 items-center border border-ink bg-ink px-5 py-2.5 text-sm text-sheet hover:opacity-90"
        >
          Issue an invoice
        </Link>
      </div>

      {/* Money the contract is holding because it could not push it. Nothing else in the
          app would mention it, so a payment would appear to have vanished. */}
      {claimable !== "0" ? (
        <ClaimPayout
          amount={claimable}
          token={publicEnv.tokenId}
          contractId={publicEnv.contractId}
        />
      ) : null}

      {mine.length > 0 ? (
        <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(12rem,100%),1fr))] gap-px border border-rule bg-rule">
          <Figure label="Outstanding" count={`Across ${owed.length}`}>
            {formatAmount(sum(owed.map((i) => i.unpaid)))}
          </Figure>
          <Figure
            label="Overdue"
            tone="text-stamp-red"
            count={overdue.length === 0 ? "None past due" : `${overdue.length} past due`}
          >
            {formatAmount(sum(overdue.map((i) => i.unpaid)))}
          </Figure>
          <Figure label="Settled" tone="text-stamp-green" count="Paid to you in full">
            {formatAmount(sum(mine.filter((i) => i.stored_status === "Paid").map((i) => i.paid)))}
          </Figure>
          <Figure
            label="Listed for sale"
            tone="text-gold"
            count={listed.length === 0 ? "Nothing listed" : `${listed.length} on the market`}
          >
            {formatAmount(sum(listed.map((i) => i.listing ?? "0")))}
          </Figure>
        </div>
      ) : null}

      <Ledger
        title="Sent"
        invoices={sent}
        empty="You have not sent an invoice yet. The first one takes about a minute."
      />
      <Ledger
        title="Billed to you"
        invoices={received}
        empty="Nothing has been billed to you yet."
      />
    </>
  );
}

function Figure({
  label,
  count,
  tone = "",
  children,
}: {
  label: string;
  count: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-sheet px-5 py-4">
      <p className={`text-xs ${tone || "text-ink/60"}`}>{label}</p>
      <p className="mt-1.5 flex items-baseline gap-2">
        <span className={`tabular text-lg ${tone}`}>{children}</span>
        <span className="font-mono text-xs text-ink/60">USDC</span>
      </p>
      <p className="mt-1 text-xs text-ink/60">{count}</p>
    </div>
  );
}

function Ledger({
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
      <div className="flex items-center gap-5">
        <h2 className="text-base whitespace-nowrap">{title}</h2>
        <span className="h-px flex-1 bg-rule" />
        {invoices ? (
          <span className="font-mono text-xs text-ink/60">{invoices.length}</span>
        ) : null}
      </div>

      {/* `null` means the read failed, which is not the same as having none. Saying
          "nothing here" after a network error would be a lie. */}
      {invoices === null ? (
        <p className="mt-4 border border-stamp-red/40 bg-sheet p-4 text-xs text-stamp-red">
          Could not reach the contract just now, so this list is not shown rather than
          shown wrong. Reload to try again.
        </p>
      ) : invoices.length === 0 ? (
        <p className="mt-4 border border-rule bg-sheet p-4 text-xs text-ink/60">{empty}</p>
      ) : (
        <ul className="mt-4 border-t border-rule">
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link
                href={`/app/invoice/${invoice.id}`}
                className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-rule bg-sheet px-4 py-3.5 hover:bg-paper"
              >
                <Stub id={invoice.id} />
                <span className="min-w-0">
                  <span className="serial block text-xs">
                    No. {invoice.id.padStart(10, "0")}
                  </span>
                  <span className="mt-1 block">
                    {invoice.client ? (
                      <AccountChip accountId={invoice.client} />
                    ) : (
                      <span className="text-xs text-ink/60 italic">not accepted yet</span>
                    )}
                  </span>
                </span>
                <span className="flex-1" />
                <span className="text-right">
                  <span className="tabular block text-sm">
                    <Amount value={invoice.amount} symbol="USDC" />
                  </span>
                  <span className="mt-1 block text-xs text-ink/60">
                    {invoice.paid === "0" ? (
                      "nothing paid"
                    ) : (
                      <>
                        <Amount value={unpaid(invoice.amount, invoice.paid)} /> still owed
                      </>
                    )}
                  </span>
                </span>
                <StatusPill status={invoice.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The instrument reduced to a stub: a torn edge and a number. */
function Stub({ id }: { id: string }) {
  return (
    <span
      className="flex h-11 w-9 flex-none flex-col justify-between border border-rule bg-paper"
      aria-hidden="true"
    >
      <span className="comb h-1" />
      <span className="tabular text-center font-mono text-sm">{id}</span>
      <span className="comb h-1" />
    </span>
  );
}
