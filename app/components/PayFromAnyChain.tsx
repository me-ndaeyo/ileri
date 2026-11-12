"use client";

import { useEffect, useState } from "react";
import { Button, Pending } from "@/components/Button";

interface Option {
  symbol: string;
  chain: string;
}

interface Quote {
  depositAddress: string | null;
  amountIn: string | null;
  originSymbol: string;
  originChain: string;
  deadline: string | null;
  route: "native" | "relay";
}

/**
 * Pay an invoice from a chain other than NEAR.
 *
 * The options come from 1Click's own token list rather than a set written here, so the
 * selector cannot offer a route that does not exist. The browser sends back a symbol and
 * a chain; the asset id is resolved server side, where the partner token lives.
 *
 * On testnet the quote route answers 409 with an explanation, because NEAR Intents has no
 * testnet. This component shows that answer rather than hiding it: a payer who cannot use
 * this route should be told why and pointed at the one that works, not left pressing a
 * button that will not help them.
 */
export function PayFromAnyChain({ invoiceId }: { invoiceId: string }) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [picked, setPicked] = useState<Option | null>(null);
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/pay/assets");
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { options: Option[] };
        if (!cancelled) setOptions(body.options);
      } catch {
        // Not an error worth shouting about: the NEAR route above still works, and this
        // section simply does not offer anything.
        if (!cancelled) setOptions([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function getQuote() {
    if (!picked) return;
    setError(null);
    setBusy(true);
    setQuote(null);
    try {
      const response = await fetch("/api/pay/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          originSymbol: picked.symbol,
          originChain: picked.chain,
          refundTo,
        }),
      });
      const body = (await response.json()) as Partial<Quote> & { error?: string };
      if (!response.ok) {
        setError(body.error ?? `Could not get a quote (${response.status})`);
        return;
      }
      setQuote(body as Quote);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not get a quote");
    } finally {
      setBusy(false);
    }
  }

  if (options !== null && options.length === 0) return null;

  return (
    <section className="mt-8 border border-rule bg-sheet p-5">
      <h2 className="text-base">Pay from another chain</h2>
      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/70">
        Send what you already hold and NEAR Intents converts it, delivering USDC to the
        invoice. You get a deposit address on your own chain, so you need no NEAR wallet
        and no account here.
      </p>

      <div className="mt-5">
        <p className="text-xs text-ink/60">What are you paying with?</p>
        {options === null ? (
          <p className="mt-2 text-xs text-ink/60">
            Loading the routes 1Click supports <Pending className="w-20" />
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {options.map((option) => {
              const active =
                picked?.symbol === option.symbol && picked?.chain === option.chain;
              return (
                <button
                  key={`${option.symbol}-${option.chain}`}
                  type="button"
                  onClick={() => setPicked(option)}
                  aria-pressed={active}
                  className={`min-h-11 border px-3 py-2 text-left text-xs ${
                    active ? "border-ink bg-ink text-sheet" : "border-rule hover:bg-paper"
                  }`}
                >
                  <span className="block font-medium">{option.symbol}</span>
                  <span className="block opacity-75">on {option.chain}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {picked ? (
        <div className="mt-5">
          <label className="block">
            <span className="text-xs text-ink/60">
              Your address on {picked.chain}, for any refund
            </span>
            <input
              className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-mono text-xs outline-none focus:border-stamp-blue"
              value={refundTo}
              onChange={(event) => setRefundTo(event.target.value)}
              placeholder={`where a refund should go on ${picked.chain}`}
            />
          </label>
          <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-ink/60">
            Send from a wallet you control rather than an exchange. A refund goes back to
            the address the money came from, and an exchange withdrawal arrives from one
            you cannot receive at.
          </p>
          <Button
            className="mt-4"
            onClick={getQuote}
            busy={busy ? "Getting a quote" : null}
            disabled={refundTo.trim().length < 4}
            tone="primary"
          >
            Get a deposit address
          </Button>
        </div>
      ) : null}

      {quote?.depositAddress ? (
        <div className="mt-5 border border-ink bg-paper p-4">
          <p className="text-xs text-ink/60">
            Send exactly {quote.amountIn ?? "the quoted amount"} {quote.originSymbol} on{" "}
            {quote.originChain} to
          </p>
          <p className="mt-2 font-mono text-xs break-all">{quote.depositAddress}</p>
          {quote.deadline ? (
            <p className="mt-3 text-xs text-stamp-red">
              This address stops accepting at {new Date(quote.deadline).toLocaleTimeString()}.
              After that, ask for a new one rather than sending late.
            </p>
          ) : null}
          <p className="mt-3 max-w-[62ch] text-xs leading-relaxed text-ink/60">
            The invoice reads as paid only once the contract has the money, not when the
            deposit clears. This page will not say otherwise.
            {quote.route === "relay"
              ? " On this deployment the funds pass through an account we control for a few seconds before reaching the contract."
              : null}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 border border-stamp-red/40 bg-paper p-3 text-xs leading-relaxed text-stamp-red">
          {error}
        </p>
      ) : null}
    </section>
  );
}
