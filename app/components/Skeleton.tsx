/**
 * What a screen shows while its content streams.
 *
 * Every page here is partially prerendered: the frame is static and arrives instantly,
 * and the part that depends on the request, the session cookie or a contract view,
 * streams in after. That gap used to be a line of grey text, which read as an empty page
 * rather than a loading one.
 *
 * These stand in the shape of the thing that is coming, carrying the real chrome: the
 * guilloche band, the ruled rows, the comb foot. A sheet with its figures not yet set
 * reads as a document being filled in, which is what is actually happening.
 *
 * Deliberately not animated. The stamp press is the only motion in the product, and
 * since the reduced-motion rule would strip a pulse for a good share of people anyway,
 * a static skeleton is the honest baseline rather than the degraded one. Carrying the
 * real chrome is what makes it read as intentional instead of broken.
 *
 * A skeleton is invisible to a screen reader, so each one is a live region that says it
 * is loading and names what for.
 */

/** One placeholder bar, in the colour of an unprinted field. */
function Line({ className = "" }: { className?: string }) {
  return <div className={`bg-wash ${className}`} aria-hidden="true" />;
}

function Busy({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** The invoice sheet, before its figures are set. */
export function SheetSkeleton() {
  return (
    <Busy label="Loading the invoice">
      <article className="relative overflow-hidden border border-rule bg-sheet">
        <div className="band h-6 w-full" aria-hidden="true" />

        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <p className="font-serif text-lg leading-none">Ileri</p>
            <p className="mt-1 text-xs text-ink/60">Promise to pay the bearer</p>
          </div>
          <Line className="mt-1 h-3 w-28" />
        </div>

        <div className="px-6 pt-6">
          <p className="text-xs text-ink/60">Amount due</p>
          <Line className="mt-2 h-9 w-52" />
          <Line className="mt-2.5 h-3 w-64" />
        </div>

        <div className="flex flex-wrap gap-x-10 gap-y-4 px-6 pt-6">
          {["Issued by", "Payable by", "Due"].map((label) => (
            <div key={label}>
              <p className="text-xs text-ink/60">{label}</p>
              <Line className="mt-1.5 h-3 w-32" />
            </div>
          ))}
        </div>

        <dl className="mt-6 border-t border-rule">
          {["Paid so far", "Still owed", "Paid to"].map((label) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 border-b border-rule px-6 py-3 last:border-0"
            >
              <dt className="text-xs text-ink/60">{label}</dt>
              <dd>
                <Line className="h-3 w-24" />
              </dd>
            </div>
          ))}
        </dl>

        <div className="px-6 pt-6">
          <div className="double-rule" />
        </div>

        <div className="flex items-center justify-between gap-4 px-6 py-5">
          <Line className="h-3 w-40" />
          <Line className="h-8 w-24" />
        </div>

        <div className="comb" aria-hidden="true" />
      </article>
    </Busy>
  );
}

/**
 * A list of invoices, before the rows arrive. Used by the dashboard and the market.
 *
 * `rows` should match what the screen usually shows, so the page does not jump when the
 * real list lands.
 */
export function LedgerSkeleton({
  rows = 3,
  label = "Loading invoices",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <Busy label={label}>
      <div className="border-t border-rule">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 border-b border-rule bg-sheet px-4 py-4"
          >
            <div className="flex items-center gap-3">
              {/* The serial stub, which is the one thing a row always leads with. */}
              <div
                className="flex h-11 w-9 flex-col justify-between border border-rule bg-paper"
                aria-hidden="true"
              >
                <div className="comb h-1" />
                <div className="comb h-1" />
              </div>
              <div>
                <Line className="h-3 w-20" />
                <Line className="mt-2 h-3 w-36" />
              </div>
            </div>
            <div className="flex flex-col items-end">
              <Line className="h-3 w-20" />
              <Line className="mt-2 h-3 w-14" />
            </div>
          </div>
        ))}
      </div>
    </Busy>
  );
}

/**
 * A bordered panel of fields or actions: the accept box, the pay box, the buy box, the
 * issue form.
 */
export function PanelSkeleton({
  lines = 3,
  label = "Loading",
}: {
  lines?: number;
  label?: string;
}) {
  return (
    <Busy label={label}>
      <section className="border border-rule bg-sheet p-5">
        <Line className="h-4 w-40" />
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: lines }, (_, i) => (
            <Line key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
          ))}
        </div>
        <Line className="mt-5 h-11 w-36" />
      </section>
    </Busy>
  );
}
