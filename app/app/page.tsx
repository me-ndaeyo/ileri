import Link from "next/link";
import { Circled } from "@/components/Circled";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { InvoiceStory } from "@/components/InvoiceStory";
import { ThemeToggle } from "@/components/ThemeToggle";
import { publicEnv } from "@/lib/env";
import { HERO } from "@/lib/sample-invoice";

export const metadata = {
  title: "Ileri, invoices that pay the bearer",
  description:
    "Issue an invoice as an NFT on NEAR, get paid from any chain, and sell it early. " +
    "Payment always goes to whoever holds the invoice.",
};

/**
 * The landing page.
 *
 * Fully static, which is why nothing here reads the clock or a cookie: the illustration
 * has fixed dates and the sheet is told not to count days to the due date. The only
 * client code is the walkthrough, because the product's whole point is a change of hands
 * that is easier to watch than to read about.
 *
 * The numbers in the proof strip are facts about this repository, checkable from it.
 * Nothing here claims a customer or a volume we do not have.
 */
export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-rule bg-paper">
        <div className="mx-auto flex w-full max-w-[1080px] items-center gap-x-4 px-5 py-3 sm:gap-x-8 sm:py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="mark h-8 w-8 flex-none" aria-hidden="true" />
            <span className="font-serif text-lg leading-none">Ileri</span>
          </Link>
          {/* Hidden on a phone. Five items in one row had to wrap, and these three are
              the ones worth losing: two are in-page anchors to content the reader is
              about to scroll through anyway, and the market is reachable from the
              footer. What stays is the theme and the way into the app. */}
          <nav className="hidden gap-6 text-sm sm:flex">
            <Link href="/market" className="hover:text-stamp-red">
              Market
            </Link>
            <a href="#how" className="hover:text-stamp-red">
              How it works
            </a>
            <a href="#questions" className="hover:text-stamp-red">
              Questions
            </a>
          </nav>
          <span className="flex-1" />
          <ThemeToggle />
          <Link
            href="/app"
            className="tap-44 inline-flex min-h-7 items-center border border-ink px-2 py-1 text-[0.6875rem] hover:bg-sheet sm:min-h-11 sm:px-4 sm:py-2 sm:text-sm"
          >
            Your invoices
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="border-b border-rule">
          <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center gap-x-14 gap-y-12 px-5 py-16">
            <div className="min-w-0 flex-[999_1_26rem]">
              <p className="inline-flex items-center gap-2.5 border border-rule bg-sheet px-3 py-1.5">
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-stamp-green" />
                <span className="font-mono text-xs text-ink-soft">
                  Live on {publicEnv.network}, {publicEnv.contractId}
                </span>
              </p>
              <h1 className="mt-6 max-w-[22ch] font-serif text-2xl leading-[1.04] tracking-tight text-balance sm:text-3xl">
                Send the invoice. Get paid from any chain. Sell it if you cannot wait.
              </h1>
              <p className="mt-5 max-w-[56ch] text-base leading-relaxed text-ink-soft">
                Ileri issues your invoice as a bearer instrument on NEAR. Your client pays
                with whatever they already hold, on whatever chain they hold it. Need the
                money before the due date? Sell the invoice, and every later payment goes
                to the buyer automatically.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-4">
                <Link
                  href="/app/new"
                  className="inline-flex min-h-11 items-center border border-stamp-red bg-stamp-red px-6 py-3 text-base text-sheet hover:opacity-90"
                >
                  Issue an invoice
                </Link>
                <a
                  href="#how"
                  className="inline-flex min-h-11 items-center px-1 text-base text-ink-soft underline decoration-rule underline-offset-[5px] hover:text-ink"
                >
                  Walk through one invoice
                </a>
              </div>
              <p className="mt-5 max-w-[52ch] text-xs leading-relaxed text-ink-soft">
                No account to open and no fee to the platform. You need a NEAR wallet.
                Your client does not.
              </p>
            </div>

            <div className="min-w-0 flex-[1_1_22rem]">
              {/* The sold copy, sitting behind and slightly turned. An invoice here can
                  change hands, and two sheets say that before a word is read. */}
              <div className="relative">
                <div
                  className="absolute -bottom-4 -right-4 left-4 top-4 rotate-[1.6deg] border border-rule bg-wash"
                  aria-hidden="true"
                />
                <div className="relative">
                  <InvoiceSheet invoice={HERO} relativeDue={false} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What is true about this build, and checkable */}
        <section className="border-b border-rule bg-sheet">
          <div className="mx-auto grid w-full max-w-[1080px] grid-cols-[repeat(auto-fit,minmax(min(14rem,100%),1fr))] gap-8 px-5 py-10">
            <Fact figure="102">
              Tests in the app, on top of the contract&apos;s own suite, spoofed payments
              included.
            </Fact>
            <Fact figure="Nobody">
              Holds your money. The contract pays the holder in the same call that records
              the payment.
            </Fact>
            <Fact figure={<Circled>0%</Circled>}>
              Platform fee on an invoice or a sale.
            </Fact>
            <Fact figure="Off">
              Token approvals are disabled, so no third party can move your invoice.
            </Fact>
          </div>
        </section>

        {/* The walkthrough */}
        <section id="how" className="border-b border-rule">
          <div className="mx-auto w-full max-w-[1080px] px-5 py-16">
            <Heading>Follow one invoice</Heading>
            <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-ink-soft">
              Invoice no. 7, from the Monday it was written to the day the money landed.
              Pick a step, or walk it through.
            </p>
            <InvoiceStory />
          </div>
        </section>

        {/* The fair questions */}
        <section id="questions" className="relative overflow-hidden border-b border-rule bg-sheet">
          <div
            className="rosette pointer-events-none absolute -right-20 top-10 h-96 w-96 opacity-10"
            aria-hidden="true"
          />
          <div className="relative mx-auto w-full max-w-[1080px] px-5 py-16">
            <Heading>The fair questions</Heading>
            <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-ink-soft">
              The ones worth asking before you put a real invoice through. Each answer is
              countersigned by the part of the contract that enforces it.
            </p>
            <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-10">
              <Question
                question="My client has never touched crypto."
                countersign="1Click customRecipientMsg, delivering with ft_transfer_call"
              >
                They do not need a NEAR wallet or an account with us. The link opens an
                invoice they can read, and paying is a transfer to an address on the chain
                they already use. Everything after that is the contract&apos;s job.
              </Question>
              <Question
                question="Who is holding the money?"
                countersign="ft_on_transfer, state before the transfer, claimable on failure"
              >
                Nobody. A payment arrives at the contract, which records it and pushes it
                to whoever holds the invoice in the same call. If that push ever fails, the
                amount becomes claimable by the holder instead of getting stuck. We cannot
                move it.
              </Question>
              <Question
                question="Is my client's data on a public chain?"
                countersign="doc_hash on chain, read checked against nft_token owner_id"
              >
                Account ids, the amount and the due date are public, and we say so rather
                than pretending otherwise. Names, line items and notes live in an encrypted
                file that only the issuer, the client and the current holder can open. The
                chain keeps a hash of it, which proves it never changed.
              </Question>
              <Question
                question="What if the client never pays?"
                countersign="get_reputation, raw counters the contract keeps, no score of ours"
              >
                Then the invoice goes overdue and stays unpaid, and a buyer who took it on
                carries that risk. Ileri gives a buyer the record to judge it with: how
                much is paid, how often this client has paid on time, and how often late.
                There is no insurance and no recourse, and the market says so on every
                listing.
              </Question>
            </div>
          </div>
        </section>

        {/* Closing */}
        <section>
          <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center justify-between gap-x-10 gap-y-8 px-5 py-16">
            <div className="min-w-0 flex-[999_1_24rem]">
              <h2 className="max-w-[28ch] font-serif text-xl leading-tight text-balance">
                An invoice is a promise. Make it one you can act on.
              </h2>
              <p className="mt-4 max-w-[48ch] text-base leading-relaxed text-ink-soft">
                Issue the first one in about a minute. You can send it, sell it, or leave
                it to be paid.
              </p>
            </div>
            <div className="flex flex-[1_1_16rem] flex-wrap items-center gap-4">
              <Link
                href="/app/new"
                className="inline-flex min-h-11 items-center border border-ink bg-ink px-6 py-3 text-base text-sheet hover:opacity-90"
              >
                Issue an invoice
              </Link>
              <Link
                href="/market"
                className="inline-flex min-h-11 items-center px-1 text-base text-ink-soft underline decoration-rule underline-offset-[5px] hover:text-ink"
              >
                Browse invoices for sale
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink">
        <div className="band h-5 w-full" aria-hidden="true" />
        <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-baseline gap-x-12 gap-y-6 px-5 pb-10 pt-7">
          <span className="flex items-center gap-2.5">
            <span className="mark h-7 w-7 flex-none" aria-hidden="true" />
            <span className="font-serif text-base leading-none">Ileri</span>
          </span>
          <p className="max-w-[44ch] text-xs leading-relaxed text-ink-soft">
            Yoruba for promise. Built for the NEAR hackathon on {publicEnv.network}.
            Amounts, account names and due dates on this network are public on chain.
          </p>
          <span className="flex-1" />
          <nav className="flex flex-wrap gap-5 text-xs">
            <a href="#how" className="text-ink-soft hover:text-ink">
              How it works
            </a>
            <Link href="/market" className="text-ink-soft hover:text-ink">
              Market
            </Link>
            <Link href="/app" className="text-ink-soft hover:text-ink">
              Your invoices
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-5">
      <h2 className="font-serif text-xl leading-tight whitespace-nowrap">{children}</h2>
      <span className="h-px flex-1 bg-rule" />
    </div>
  );
}

function Fact({
  figure,
  children,
}: {
  figure: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="tabular text-lg">{figure}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}

/**
 * An answer, countersigned by the code that enforces it.
 *
 * The seal is the point: an assurance on a marketing page is worth nothing, and naming
 * the method a reader can go and check is worth something.
 */
function Question({
  question,
  countersign,
  children,
}: {
  question: string;
  countersign: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l border-stamp-red pl-6">
      <h3 className="text-base font-medium">{question}</h3>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{children}</p>
      <p className="mt-4 flex items-start gap-2.5 border-t border-rule pt-3">
        <span className="seal mt-px h-5 w-5 flex-none" aria-hidden="true" />
        <span className="font-mono text-xs leading-relaxed text-ink-soft">
          countersigned by {countersign}
        </span>
      </p>
    </div>
  );
}
