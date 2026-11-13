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
            <p className="mt-1 text-xs text-ink-soft">Promise to pay the bearer</p>
          </div>
          <Line className="mt-1 h-3 w-28" />
        </div>

        <div className="px-6 pt-6">
          <p className="text-xs text-ink-soft">Amount due</p>
          <Line className="mt-2 h-9 w-52" />
          <Line className="mt-2.5 h-3 w-64" />
        </div>

        <div className="flex flex-wrap gap-x-10 gap-y-4 px-6 pt-6">
          {["Issued by", "Payable by", "Due"].map((label) => (
            <div key={label}>
              <p className="text-xs text-ink-soft">{label}</p>
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
              <dt className="text-xs text-ink-soft">{label}</dt>
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
            className="flex items-center gap-4 border-b border-rule bg-sheet px-4 py-3.5"
          >
            {/* The serial stub, which is the one thing a row always leads with. */}
            <div
              className="flex h-11 w-9 flex-none flex-col justify-between border border-rule bg-paper"
              aria-hidden="true"
            >
              <div className="comb h-1" />
              <div className="comb h-1" />
            </div>

            {/* The same two lines the real row has. */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <Line className="h-3 w-28" />
                <Line className="h-5 w-20" />
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <Line className="h-5 w-36" />
                <div className="flex-none text-right">
                  <Line className="h-3 w-20" />
                  <Line className="mt-1 h-3 w-14" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Busy>
  );
}

/**
 * The dashboard, before the account's figures arrive.
 *
 * Mirrors the real layout: the title and its action, the four summary figures, then the
 * two labelled ledgers. A bare list of rows was the wrong shape, so the page jumped twice
 * as it loaded, once when the figures appeared above the list and again when the second
 * section pushed in below it.
 *
 * The labels are the real ones. They are known before the data is, and a skeleton that
 * can say what it is loading should.
 */
export function DashboardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Busy label="Loading your invoices">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <h1 className="font-serif text-xl leading-tight">Your invoices</h1>
          <Line className="mt-3 h-3 w-56" />
        </div>
        <span className="flex-1" />
        <Line className="h-11 w-40" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-[repeat(auto-fit,minmax(min(12rem,100%),1fr))]">
        {["Outstanding", "Overdue", "Settled", "Listed for sale"].map((label) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-3 bg-sheet px-4 py-2.5 sm:block sm:px-5 sm:py-4"
          >
            <p className="text-xs text-ink-soft">{label}</p>
            <Line className="h-4 w-24 sm:mt-2 sm:h-6 sm:w-28" />
            <Line className="mt-2 hidden h-3 w-24 sm:block" />
          </div>
        ))}
      </div>

      {["Sent", "Billed to you"].map((title, i) => (
        <section key={title} className="mt-10">
          <div className="flex items-center gap-5">
            <h2 className="text-base whitespace-nowrap">{title}</h2>
            <span className="h-px flex-1 bg-rule" />
          </div>
          <div className="mt-4">
            <LedgerSkeleton rows={i === 0 ? rows : Math.max(1, rows - 2)} label={`Loading ${title.toLowerCase()}`} />
          </div>
        </section>
      ))}
    </Busy>
  );
}

/**
 * The market, before the listings arrive.
 *
 * Mirrors the card rather than reusing the ledger rows: the market is a grid of cut
 * stubs, and a skeleton of horizontal rows reflowing into cards is a worse jump than no
 * skeleton at all. The band and the comb foot are real, so the shape is right the moment
 * it paints.
 */
export function CardsSkeleton({
  cards = 3,
  label = "Loading invoices for sale",
}: {
  cards?: number;
  label?: string;
}) {
  return (
    <Busy label={label}>
      <ul className="grid list-none grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-5">
        {Array.from({ length: cards }, (_, i) => (
          <li key={i} className="flex flex-col border border-rule bg-sheet">
            <div className="band h-4 w-full" aria-hidden="true" />

            <div className="flex items-start justify-between gap-4 px-5 pt-4">
              <div>
                <Line className="h-3 w-28" />
                <Line className="mt-2 h-6 w-36 rounded-full" />
              </div>
              <Line className="h-5 w-20" />
            </div>

            <div className="px-5 pt-4">
              <p className="text-xs text-ink-soft">Asking price</p>
              <Line className="mt-1.5 h-6 w-32" />
            </div>

            <div className="mt-4 px-5">
              {["You collect", "Your return", "You wait", "Client's record"].map(
                (row, j) => (
                  <div
                    key={row}
                    className={`flex items-baseline justify-between gap-4 py-2 ${
                      j === 3 ? "" : "border-b border-rule"
                    }`}
                  >
                    <span className="text-xs text-ink-soft">{row}</span>
                    <Line className="h-3 w-20" />
                  </div>
                ),
              )}
            </div>

            <div className="flex-1" />
            <div className="comb mt-4" aria-hidden="true" />
          </li>
        ))}
      </ul>
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
