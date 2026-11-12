import { Amount } from "@/components/Amount";
import { Stamp } from "@/components/Stamp";
import { publicEnv } from "@/lib/env";
import { amountInWords, daysUntil, formatAmount, paidPercent } from "@/lib/money";
import type { InvoiceView } from "@/lib/near";

/**
 * An invoice, as the bearer instrument it is.
 *
 * The hero of every key screen, and the only place in the app that carries security
 * printing: a guilloche band across the head, a rosette watermark behind the amount, a
 * comb foot where a note is torn when it is cashed or sold. Everything around it stays a
 * quiet ledger so this is the one thing that shines.
 *
 * The amount is stated twice, in figures and in words, which is not decoration. A bearer
 * instrument does that because words cannot be altered by adding a nought.
 *
 * It shows only what is already public on chain. Line items, names and notes live in the
 * encrypted offchain file and are passed in as children by callers entitled to see them.
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
  const words = amountInWords(invoice.amount);
  const settled =
    invoice.status === "Paid" ||
    invoice.status === "Cancelled" ||
    invoice.status === "Rejected";
  // The holder is who the next payment reaches, and once an invoice has been sold that
  // is no longer the issuer. Saying so on the sheet is the whole point of the design.
  const sold = invoice.holder !== null && invoice.holder !== invoice.issuer;

  return (
    <article className="relative overflow-hidden border border-rule bg-sheet">
      <div className="band h-6 w-full" aria-hidden="true" />
      <div
        className="rosette pointer-events-none absolute -right-8 top-24 h-52 w-52 opacity-40"
        aria-hidden="true"
      />

      {/* Masthead */}
      <div className="relative flex flex-wrap items-start justify-between gap-4 px-6 pt-6">
        <div>
          <p className="font-serif text-lg leading-none">Ileri</p>
          <p className="mt-1 text-xs text-ink/60">Promise to pay the bearer</p>
        </div>
        <div className="text-right">
          <p className="serial text-xs">No. {invoice.id.padStart(10, "0")}</p>
          <p className="mt-1 font-mono text-xs text-ink/60">{publicEnv.contractId}</p>
        </div>
      </div>

      {/* The figure, then the figure in words */}
      <div className="relative px-6 pt-6">
        <p className="text-xs text-ink/60">Amount due</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="tabular font-serif text-2xl leading-none">
            {formatAmount(invoice.amount)}
          </span>
          <span className="font-mono text-xs text-ink/60">USDC</span>
        </p>
        {words ? <p className="mt-1.5 text-xs text-ink/60">{words}</p> : null}
      </div>

      {/* The parties and the date */}
      <div className="relative flex flex-wrap gap-x-10 gap-y-4 px-6 pt-6">
        <Field label="Issued by">
          <span className="font-mono text-xs">{invoice.issuer}</span>
        </Field>
        <Field label="Payable by">
          {invoice.client ? (
            <span className="font-mono text-xs">{invoice.client}</span>
          ) : (
            // No client until somebody accepts, and that absence is worth stating.
            <span className="text-xs text-ink/60">Not yet accepted</span>
          )}
        </Field>
        <Field label="Due">
          <span className="tabular text-xs">{formatDate(invoice.due_date)}</span>
          {settled ? null : (
            <span className="text-xs text-ink/60">
              {days >= 0 ? ` · in ${days} days` : ` · ${Math.abs(days)} days ago`}
            </span>
          )}
        </Field>
      </div>

      {/* The ledger */}
      <dl className="relative mt-6 border-t border-rule">
        <Row label="Paid so far">
          <Amount value={invoice.paid} symbol="USDC" />
        </Row>
        <Row label="Still owed">
          <Amount value={invoice.unpaid} symbol="USDC" />
        </Row>
        <Row label="Paid to">
          {invoice.holder ? (
            <span className="font-mono text-xs">
              {invoice.holder}
              {sold ? <span className="text-ink/60"> · bought it</span> : null}
            </span>
          ) : (
            <span className="text-xs text-ink/60">Closed</span>
          )}
        </Row>
      </dl>

      {hasPayment ? (
        <div className="relative px-6 pt-4">
          {/* The bar follows the number, it never replaces it. */}
          <div
            className="h-1.5 w-full border border-rule bg-wash"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Paid so far"
          >
            <div
              className="h-full bg-stamp-blue"
              // A real payment always shows, however small, so the bar never reads as
              // empty on an invoice that has received money.
              style={{ width: `${Math.max(percent, 1)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink/60">
            {percent >= 100 ? "Paid in full" : `${percent.toFixed(1)}% paid`}
          </p>
        </div>
      ) : null}

      <div className="relative px-6 pt-6">
        <div className="double-rule" />
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-xs text-ink/60">Document hash, sha256</p>
          <p className="mt-1 font-mono text-xs text-ink/60">
            {invoice.doc_hash.slice(0, 14)}…{invoice.doc_hash.slice(-4)}
          </p>
        </div>
        <Stamp status={invoice.status} />
      </div>

      {children ? (
        <div className="relative border-t border-rule px-6 py-5">{children}</div>
      ) : null}

      {/* The comb foot: where a note is torn when it is cashed or sold. */}
      <div className="comb" aria-hidden="true" />
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink/60">{label}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative flex items-baseline justify-between gap-4 border-b border-rule px-6 py-2.5 last:border-0">
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
