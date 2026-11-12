"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Amount } from "@/components/Amount";
import { Button } from "@/components/Button";
import { formatAmount } from "@/lib/money";
import { callContract } from "@/lib/wallet";

/** 100 Tgas. One transfer and its callback, no deeper chain than that. */
const CLAIM_GAS = "100000000000000";

/**
 * Money the contract is holding for you because it could not push it.
 *
 * When a payment lands, the contract forwards it to the invoice's holder in the same
 * call. If the holder is not registered on the token contract that transfer fails, and
 * rather than strand the money the contract credits it to `claimable` for them to collect.
 *
 * This component exists because nothing else in the app mentioned it. A freelancer who had
 * never touched that token would watch a payment arrive on chain, see their balance
 * unchanged, and have no way to find out why. That is the worst failure this app could
 * have, and it was invisible.
 */
export function ClaimPayout({
  amount,
  token,
  contractId,
}: {
  amount: string;
  token: string;
  contractId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setError(null);
    setBusy(true);
    try {
      await callContract({
        receiverId: contractId,
        methodName: "withdraw_claimable",
        args: { token },
        gas: CLAIM_GAS,
      });
      // Re-read, rather than assume. The contract zeroes the balance before it sends and
      // re-credits it if the send fails, so the only honest figure is the one it reports.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not go through");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 border border-stamp-red bg-sheet p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="min-w-0 flex-[999_1_24rem]">
          <h2 className="text-base">
            <Amount value={amount} symbol="USDC" /> could not be delivered to you
          </h2>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/70">
            Your account was not registered on {token} when a payment landed, so the
            contract is holding the money for you rather than losing it. Claiming registers
            you and sends it on.
          </p>
        </div>
        <Button
          onClick={claim}
          busy={busy ? "Check your wallet" : null}
          tone="danger"
          className="border-stamp-red bg-stamp-red text-sheet hover:opacity-90"
        >
          Claim {formatAmount(amount)} USDC
        </Button>
      </div>
      {error ? (
        <p className="mt-4 border border-stamp-red/40 bg-paper p-3 text-xs text-stamp-red">
          {error}
        </p>
      ) : null}
    </section>
  );
}
