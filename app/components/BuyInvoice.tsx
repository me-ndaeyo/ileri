"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { Button, Pending } from "@/components/Button";
import { ConnectWallet } from "@/components/ConnectWallet";
import { formatAmount, toBigInt } from "@/lib/money";
import { view, type ListingView } from "@/lib/near";
import { callContract } from "@/lib/wallet";

/** 300 Tgas, the most a transaction may attach. */
const BUY_GAS = "300000000000000";

/**
 * Buy a listed invoice.
 *
 * The whole sale is one `ft_transfer_call` on the payment token. The contract's
 * `ft_on_transfer` moves the NFT, clears the listing and pays the seller in the same
 * call, so there is no approval to grant, no escrow to trust and no second step. A buy
 * the contract refuses returns the money rather than panicking, so a mistake here costs
 * gas and nothing else.
 */
export function BuyInvoice({
  listing,
  contractId,
  viewer,
}: {
  listing: ListingView;
  contractId: string;
  viewer: string | null;
}) {
  const { invoice, price } = listing;

  if (!viewer) {
    return (
      <Panel>
        <p className="text-sm text-ink/70">
          Connect a wallet holding USDC to buy this invoice. Your wallet signs one
          transfer and the sale settles with it.
        </p>
        <div className="mt-3">
          <ConnectWallet accountId={null} />
        </div>
      </Panel>
    );
  }

  // The contract refuses a buyer who already holds the invoice, since there would be
  // nothing to move. Saying so is better than spending a wallet prompt to be told.
  if (viewer === invoice.holder) {
    return (
      <Panel>
        <p className="text-sm text-ink/70">
          You are holding this invoice, so there is nothing here to buy. Take it off the
          market from{" "}
          <Link className="underline" href={`/app/invoice/${invoice.id}`}>
            its own page
          </Link>
          .
        </p>
      </Panel>
    );
  }

  return <Buy invoice={invoice} price={price} contractId={contractId} viewer={viewer} />;
}

function Buy({
  invoice,
  price,
  contractId,
  viewer,
}: {
  invoice: ListingView["invoice"];
  price: string;
  contractId: string;
  viewer: string;
}) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bought, setBought] = useState(false);

  const asking = toBigInt(price);

  // What the buyer holds of the invoice's own token. A buy with too little simply gets
  // returned by the contract, so this check saves a pointless prompt rather than
  // protecting any funds. It is deliberately not treated as authoritative: if the call
  // fails the button stays enabled, because a failed balance read is no reason to block
  // somebody who does have the money.
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
      } finally {
        if (!cancelled) setChecked(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [invoice.token, viewer]);

  const short = balance !== null && balance < asking;

  async function buy() {
    setError(null);
    setBusy(true);
    try {
      await callContract({
        receiverId: invoice.token,
        methodName: "ft_transfer_call",
        args: {
          receiver_id: contractId,
          amount: price,
          // The contract reads this to know which invoice is being bought. It is a JSON
          // string inside the arguments, which is what NEP-141 specifies for `msg`.
          msg: JSON.stringify({ action: "buy", invoice_id: invoice.id }),
        },
        gas: BUY_GAS,
        // NEP-141 requires exactly one yoctoNEAR on `ft_transfer_call`, so a stolen
        // function-call key cannot move tokens on its own.
        deposit: "1",
      });
      setBought(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not go through");
    } finally {
      setBusy(false);
    }
  }

  // Deliberately no router.refresh(). Refreshing would re-render the server page, which
  // now reads the listing as gone and would replace this panel with "not for sale" —
  // true, but a strange thing to show somebody who has just bought it.
  if (bought) {
    return (
      <Panel tone="good">
        <h2 className="text-base">Invoice no. {invoice.id} is yours</h2>
        <p className="mt-2 text-sm text-ink/70">
          The seller has been paid and the invoice has moved to {viewer}. Every payment on
          it from now on goes to you, with nothing left to set up.
        </p>
        <Link
          className="mt-3 inline-flex min-h-11 items-center border border-ink px-4 py-2 text-sm hover:bg-paper"
          href={`/app/invoice/${invoice.id}`}
        >
          Open invoice no. {invoice.id}
        </Link>
      </Panel>
    );
  }

  return (
    <Panel>
      <h2 className="text-base">Buy this invoice</h2>
      <p className="mt-2 max-w-[56ch] text-sm text-ink/70">
        Your wallet will show one transfer of <Amount value={price} symbol="USDC" /> to{" "}
        {contractId}. The invoice moves to you and the seller is paid in that same
        transaction.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={buy}
          busy={busy ? "Check your wallet" : null}
          disabled={short}
          tone="primary"
        >
          Buy for {formatAmount(asking)} USDC
        </Button>
        <span className="text-xs text-ink/60">
          {checked ? (
            balance !== null ? (
              <>
                You hold <Amount value={balance} symbol="USDC" />
              </>
            ) : null
          ) : (
            <>
              Checking what you hold <Pending className="w-16" />
            </>
          )}
        </span>
      </div>

      {short ? (
        <p className="mt-3 text-xs text-stamp-red">
          You are short by <Amount value={asking - (balance ?? 0n)} symbol="USDC" />. Top
          up and come back.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 border border-stamp-red/40 bg-paper p-3 text-xs text-stamp-red">
          {error}
        </p>
      ) : null}

      <p className="mt-4 max-w-[56ch] text-xs text-ink/60">
        If the client never pays, you carry that loss. There is no insurance, no recourse
        against the issuer, and a sale cannot be undone.
      </p>
    </Panel>
  );
}

function Panel({
  tone,
  children,
}: {
  tone?: "good";
  children: React.ReactNode;
}) {
  const border = tone === "good" ? "border-stamp-green" : "border-ink";
  return <section className={`mt-6 border ${border} bg-sheet p-5`}>{children}</section>;
}
