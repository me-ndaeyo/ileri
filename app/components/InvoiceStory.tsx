"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { STORY } from "@/lib/sample-invoice";

/**
 * One invoice, from the Monday it was written to the day the money reached the person who
 * bought it.
 *
 * The product is hard to explain in prose because the interesting part is a change of
 * hands that nobody has to act on. So rather than describe it, this walks it: the reader
 * picks a step and watches the same sheet restamp, the holder change, and the payment at
 * the end go somewhere other than the issuer. That last beat is the whole product in one
 * movement.
 *
 * The invoice is an illustration from lib/sample-invoice, with no concept of today, which
 * is why the sheet is told not to count days to the due date.
 */

const BEATS = [
  {
    title: "You issue it",
    body:
      "Monday, and the work is done. You fill in 4,250.00 USDC due 12 December and press " +
      "issue. Ileri mints invoice no. 7 to you as an NFT, and hands you one private link " +
      "to send the client.",
  },
  {
    title: "Your client accepts",
    body:
      "They open the link, read the real invoice and sign once. Their account is written " +
      "onto no. 7 as the client. From here the promise is binding, and the invoice can be " +
      "sold.",
  },
  {
    title: "You need the money now",
    body:
      "Two weeks in, and payroll will not wait another seventeen days. You list no. 7 at " +
      "3,900.00, which is 350.00 less than you are owed. That gap is what a buyer earns " +
      "for waiting in your place.",
  },
  {
    title: "A buyer takes it on",
    body:
      "They send 3,900.00 and the contract settles it in one step: you are paid, invoice " +
      "no. 7 moves to them, the listing clears. No escrow account, and no agreement " +
      "anybody has to honour afterwards.",
  },
  {
    title: "The client pays, the buyer is paid",
    body:
      "The client pays from Base, in USDC they already held. The contract records " +
      "4,250.00 and forwards it to whoever holds no. 7, which is now the buyer. Nobody " +
      "had to remember to redirect anything.",
  },
] as const;

export function InvoiceStory() {
  const [beat, setBeat] = useState(0);
  const current = STORY[beat];
  const atStart = beat === 0;
  const atEnd = beat === BEATS.length - 1;

  return (
    <div className="mt-8 flex flex-wrap items-start gap-10">
      {/* The rail */}
      <div className="min-w-0 flex-[999_1_22rem]">
        <ol className="list-none">
          {BEATS.map((item, i) => {
            const active = i === beat;
            const done = i < beat;
            return (
              <li key={item.title}>
                <button
                  type="button"
                  onClick={() => setBeat(i)}
                  aria-current={active ? "step" : undefined}
                  className={`w-full border-l-2 px-5 py-4 text-left ${
                    active
                      ? "border-stamp-red bg-sheet"
                      : done
                        ? "border-ink hover:bg-sheet"
                        : "border-rule hover:bg-sheet"
                  }`}
                >
                  <span className="flex items-baseline gap-3">
                    <span
                      className={`font-mono text-xs tracking-widest ${
                        active ? "text-stamp-red" : "text-ink/60"
                      }`}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-base font-medium">{item.title}</span>
                  </span>
                  {active ? (
                    <span className="mt-2 block max-w-[46ch] text-sm leading-relaxed text-ink/70">
                      {item.body}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-3 pl-5">
          <Button onClick={() => setBeat(beat - 1)} disabled={atStart}>
            Back
          </Button>
          <Button onClick={() => setBeat(beat + 1)} disabled={atEnd} tone="primary">
            Next step
          </Button>
          {atStart ? null : (
            <button
              type="button"
              onClick={() => setBeat(0)}
              className="min-h-11 px-1 text-sm text-ink/60 underline decoration-rule underline-offset-4"
            >
              Start again
            </button>
          )}
        </div>
      </div>

      {/* The sheet as it stands at this beat */}
      <div className="min-w-0 flex-[1_1_22rem]">
        <InvoiceSheet invoice={current.invoice} relativeDue={false} />
        <p className="mt-3 text-sm text-ink/70">{current.note}</p>
        <p className="mt-3 text-xs text-ink/60">
          This is the token image too, drawn from the serial alone. It carries no names and
          no amounts, so it can sit in a public wallet without giving anything away.
        </p>
      </div>
    </div>
  );
}
