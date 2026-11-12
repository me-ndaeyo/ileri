"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { Button, Pending } from "@/components/Button";
import { ConnectWallet } from "@/components/ConnectWallet";
import { SignOutButton } from "@/components/SignOutButton";
import { Stamp } from "@/components/Stamp";
import { MoneyError, formatAmount, isSettled, parseAmount, toBigInt, unpaid } from "@/lib/money";
import { getInvoice, view, type InvoiceView } from "@/lib/near";
import { callContract } from "@/lib/wallet";

/** 300 Tgas, the most a transaction may attach. */
const PAY_GAS = "300000000000000";

/**
 * Pay an invoice with USDC already held on NEAR.
 *
 * This is the direct route: the payer's wallet calls `ft_transfer_call` on the token with
 * the invoice id attached, and the contract records the payment and forwards it to
 * whoever holds the invoice in the same call. No Intents, no bridge, nothing to poll.
 *
 * Paying from another chain is a different route onto the same contract method and lands
 * separately. This one exists first because it needs no third party, which means it can
 * be proven end to end on testnet.
 */
export function PayInvoice({
  invoice,
  contractId,
  viewer,
}: {
  invoice: InvoiceView;
  contractId: string;
  viewer: string | null;
}) {
  const owed = unpaid(invoice.amount, invoice.paid);

  // The contract returns the full amount for anything in a final state, so there is
  // nothing to collect and no form to show.
  if (invoice.stored_status === "Paid" || isSettled(invoice.amount, invoice.paid)) {
    return (
      <Panel tone="good">
        <div className="flex flex-wrap items-center gap-4">
          <Stamp status="Paid" />
          <p className="text-sm text-ink/70">
            This invoice is settled in full. Nothing further is owed on it.
          </p>
        </div>
      </Panel>
    );
  }

  if (invoice.stored_status === "Rejected" || invoice.stored_status === "Cancelled") {
    return (
      <Panel>
        <p className="text-sm text-ink/70">
          This invoice was {invoice.stored_status.toLowerCase()}, so it cannot take a
          payment. Any amount sent to it would be returned. If that is wrong, ask the
          issuer for a new invoice.
        </p>
      </Panel>
    );
  }

  if (!viewer) {
    return (
      <Panel>
        <h2 className="text-base">Pay with USDC on NEAR</h2>
        <p className="mt-2 max-w-[56ch] text-sm text-ink/70">
          Connect a wallet holding USDC and this settles in one transfer. The amount due
          is <Amount value={owed} symbol="USDC" />.
        </p>
        <div className="mt-3">
          <ConnectWallet accountId={null} />
        </div>
      </Panel>
    );
  }

  return (
    <>
      <Pay invoice={invoice} owed={owed} contractId={contractId} viewer={viewer} />
      <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink/60">
        <span>Paying as {viewer}</span>
        <SignOutButton />
      </p>
    </>
  );
}

function Pay({
  invoice,
  owed,
  contractId,
  viewer,
}: {
  invoice: InvoiceView;
  owed: bigint;
  contractId: string;
  viewer: string;
}) {
  const [amount, setAmount] = useState(formatAmount(owed, { grouped: false }));
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<InvoiceView | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const raw = await view<string>(invoice.token, "ft_balance_of", {
          account_id: viewer,
        });
        if (!cancelled) setBalance(toBigInt(raw));
      } catch {
        if (!cancelled) setBalance(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [invoice.token, viewer]);

  // Parsed once, here, so the button state and the call agree on the figure.
  let asking: bigint | null = null;
  let parseError: string | null = null;
  try {
    asking = parseAmount(amount);
  } catch (cause) {
    parseError = cause instanceof MoneyError ? cause.message : "Enter an amount";
  }

  const tooMuch = asking !== null && asking > owed;
  const nothing = asking !== null && asking === 0n;
  // Carried as the difference rather than a boolean, so the message below can name the
  // figure without a non-null assertion to get back to it.
  const shortBy =
    asking !== null && balance !== null && asking > balance ? asking - balance : null;
  const blocked = parseError !== null || tooMuch || nothing || shortBy !== null || busy;

  async function pay() {
    if (asking === null) return;
    setError(null);
    setBusy(true);
    try {
      await callContract({
        receiverId: invoice.token,
        methodName: "ft_transfer_call",
        args: {
          receiver_id: contractId,
          amount: asking.toString(),
          msg: JSON.stringify({ action: "pay", invoice_id: invoice.id }),
        },
        gas: PAY_GAS,
        // NEP-141 requires exactly one yoctoNEAR on `ft_transfer_call`.
        deposit: "1",
      });

      // The transaction succeeding is not the same as the invoice being paid, and the
      // difference is the one thing this app must never get wrong. Read the state back
      // from the contract and report that, never the outcome of our own call.
      const fresh = await getInvoice(contractId, invoice.id);
      setSettled(fresh ?? invoice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not go through");
    } finally {
      setBusy(false);
    }
  }

  if (settled) {
    const stillOwed = unpaid(settled.amount, settled.paid);
    const full = isSettled(settled.amount, settled.paid);
    return (
      <Panel tone="good">
        {full ? (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <Stamp status="Paid" />
              <h2 className="text-base">Invoice no. {settled.id} is paid</h2>
            </div>
            <p className="mt-3 max-w-[56ch] text-sm text-ink/70">
              The contract has it at <Amount value={settled.paid} symbol="USDC" /> of{" "}
              <Amount value={settled.amount} symbol="USDC" />, and the money has gone to{" "}
              {settled.holder ?? "its holder"}. This says paid because the contract says
              so, not because the transfer went through.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-base">
              <Amount value={settled.paid} symbol="USDC" /> received
            </h2>
            <p className="mt-2 max-w-[56ch] text-sm text-ink/70">
              <Amount value={stillOwed} symbol="USDC" /> is still owed on invoice no.{" "}
              {settled.id}. Send the rest whenever you like, in one payment or several.
            </p>
            <Button
              className="mt-3"
              onClick={() => {
                setSettled(null);
                setAmount(formatAmount(stillOwed, { grouped: false }));
              }}
            >
              Pay the rest
            </Button>
          </>
        )}
        <Link
          className="mt-3 block text-xs text-ink/60 underline"
          href={`/market/${settled.id}`}
        >
          See this invoice on the market
        </Link>
      </Panel>
    );
  }

  return (
    <Panel>
      <h2 className="text-base">Pay with USDC on NEAR</h2>
      <p className="mt-2 max-w-[60ch] text-sm text-ink/70">
        One transfer from your wallet. The contract records it and sends it on to{" "}
        <strong className="font-medium">{invoice.holder ?? "the holder"}</strong>, who
        holds this invoice right now.
        {invoice.holder && invoice.issuer !== invoice.holder ? (
          <> That is no longer the issuer, because the invoice has been sold.</>
        ) : null}
      </p>

      {invoice.stored_status === "Issued" && asking !== null && asking >= owed ? (
        <p className="mt-3 max-w-[60ch] text-xs text-ink/60">
          Paying this in full accepts it at the same time, so there is no separate step.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[12rem] flex-1">
          <span className="text-xs text-ink/60">Amount to send, in USDC</span>
          <input
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 text-sm tabular outline-none focus:border-stamp-blue"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <Button
          onClick={pay}
          busy={busy ? "Check your wallet" : null}
          disabled={blocked}
          tone="primary"
        >
          Pay{asking !== null && !tooMuch && !nothing ? ` ${formatAmount(asking)} USDC` : ""}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-ink/60">
          Due <Amount value={owed} symbol="USDC" />
        </span>
        <span className="text-ink/60">
          {balance === null ? (
            <>
              Checking what you hold <Pending className="w-16" />
            </>
          ) : (
            <>
              You hold <Amount value={balance} symbol="USDC" />
            </>
          )}
        </span>
        {asking !== null && asking < owed && asking > 0n ? (
          <span className="text-ink/60">
            Leaves <Amount value={owed - asking} symbol="USDC" /> owed
          </span>
        ) : null}
      </div>

      {parseError ? <Note tone="bad">{parseError}</Note> : null}
      {nothing ? <Note tone="bad">Enter an amount above zero.</Note> : null}
      {tooMuch ? (
        <Note tone="bad">
          The most this invoice can take is {formatAmount(owed)} USDC. Anything over that
          would be sent straight back to you, so there is no reason to send it.
        </Note>
      ) : null}
      {shortBy !== null && balance === 0n ? (
        <Note tone="bad">
          {viewer} holds no USDC on NEAR. Fund it, or pay from another chain instead.
        </Note>
      ) : null}
      {shortBy !== null && balance !== null && balance > 0n ? (
        <Note tone="bad">
          You are short by <Amount value={shortBy} symbol="USDC" />. Send a smaller amount
          now and the rest later, or top up.
        </Note>
      ) : null}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Panel>
  );
}

function Note({ tone, children }: { tone?: "bad"; children: React.ReactNode }) {
  if (tone === "bad") {
    return (
      <p className="mt-3 border border-stamp-red/40 bg-paper p-3 text-xs text-stamp-red">
        {children}
      </p>
    );
  }
  return <p className="mt-3 text-xs text-ink/60">{children}</p>;
}

function Panel({ tone, children }: { tone?: "good"; children: React.ReactNode }) {
  const border = tone === "good" ? "border-stamp-green" : "border-ink";
  return <section className={`mt-6 border ${border} bg-sheet p-5`}>{children}</section>;
}
