import { Amount } from "@/components/Amount";
import { Stamp } from "@/components/Stamp";
import { daysUntil, paidPercent } from "@/lib/money";
import type { InvoiceView } from "@/lib/near";

/**
 * An invoice, as a sheet of paper.
 *
 * The hero of every key screen. Max 720px wide with a thin top band for the issuer, and
 * ledger rows separated by rules rather than cards, so it reads like a document instead
 * of a dashboard widget.
 *
 * It shows only what is already public on chain. Line items, names and notes live in the
 * encrypted offchain file and are passed in separately by callers entitled to see them.
 */
export function InvoiceSheet({
  invoice,
  children,
}: {
  invoice: InvoiceView;
  children?: React.ReactNode;
}) {
  const days = daysUntil(invoice.due_date);
  const percent = paidPercent(invoice.amount, invoice.paid);
  // Deliberately `paid > 0`, not `percent > 0`: a real but tiny payment rounds to 0%,
  // and an empty bar would tell the issuer something false.
  const hasPayment = invoice.paid !== "0";

  return (
    <article className="border border-rule bg-sheet">
      <header className="border-b border-rule px-5 py-3">
        <p className="text-xs text-ink/60">From</p>
        <p className="text-base">{invoice.issuer}</p>
      </header>

      <div className="flex items-baseline justify-between gap-4 px-5 pt-4">
        <h2 className="text-lg">Invoice {invoice.id}</h2>
        <p className="text-xs text-ink/60">
          Due {formatDate(invoice.due_date)}
          {invoice.status === "Paid" || invoice.status === "Cancelled" || invoice.status === "Rejected"
            ? null
            : days >= 0
              ? ` · in ${days} days`
              : ` · ${Math.abs(days)} days ago`}
        </p>
      </div>

      <dl className="mt-4 border-t border-rule">
        <Row label="Billed to">
          {/* No client until somebody accepts, and that absence is worth stating. */}
          {invoice.client ?? <span className="text-ink/60">Not yet accepted</span>}
        </Row>
        <Row label="Paid to">
          {invoice.holder ?? <span className="text-ink/60">Closed</span>}
        </Row>
        <Row label="Total">
          <Amount value={invoice.amount} symbol="USDC" />
        </Row>
        <Row label="Paid">
          <Amount value={invoice.paid} symbol="USDC" />
        </Row>
        <Row label="Still owed">
          <Amount value={invoice.unpaid} symbol="USDC" />
        </Row>
      </dl>

      {hasPayment ? (
        <div className="px-5 pt-4">
          <div
            className="h-1 w-full bg-rule"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Paid so far"
          >
            <div
              className="h-1 bg-stamp-blue"
              // A real payment always shows, however small, so the bar never reads as empty
              // on an invoice that has received money.
              style={{ width: `${Math.max(percent, 1)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-ink/60">
            {percent >= 100 ? "Paid in full" : `${percent.toFixed(1)}% paid`}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-end px-5 py-5">
        <Stamp status={invoice.status} />
      </div>

      {children ? <div className="border-t border-rule px-5 py-4">{children}</div> : null}
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule px-5 py-2.5 last:border-0">
      <dt className="text-xs text-ink/60">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Nanoseconds to a plain date. Sentence case, no all-caps month. */
function formatDate(ns: string): string {
  const ms = Number(BigInt(ns) / 1_000_000n);
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
