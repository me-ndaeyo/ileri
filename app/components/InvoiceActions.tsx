"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Amount } from "@/components/Amount";
import { Button } from "@/components/Button";
import { MoneyError, formatAmount, parseAmount, unpaid } from "@/lib/money";
import { generateInviteKey, inviteLink } from "@/lib/invite";
import { callContract } from "@/lib/wallet";
import type { InvoiceView } from "@/lib/near";

/** What this viewer is to this invoice. Several can be true at once. */
export interface Roles {
  isIssuer: boolean;
  isHolder: boolean;
  isClient: boolean;
}

/**
 * The actions available on an invoice, and only those.
 *
 * Which actions appear is decided from the invoice's current state and the viewer's
 * roles, mirroring the contract's own rules. The contract is still the authority — it
 * will refuse anything wrong regardless — but offering a button that is certain to fail
 * wastes a wallet prompt and teaches people the app is unreliable.
 */
export function InvoiceActions({
  invoice,
  roles,
  contractId,
}: {
  invoice: InvoiceView;
  roles: Roles;
  contractId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotatedLink, setRotatedLink] = useState<string | null>(null);
  const [price, setPrice] = useState("");

  const owed = unpaid(invoice.amount, invoice.paid);
  const tradable =
    (invoice.stored_status === "Accepted" || invoice.stored_status === "PartiallyPaid") &&
    owed > 0n;
  const isFinal =
    invoice.stored_status === "Paid" ||
    invoice.stored_status === "Rejected" ||
    invoice.stored_status === "Cancelled";

  // A 10% discount, as a starting suggestion rather than advice. Computed here rather
  // than inline in the JSX: eslint-plugin-jsx-a11y statically evaluates attribute
  // expressions and its BigInt handling crashes on one.
  const suggestedPrice = formatAmount((owed * 9n) / 10n, { grouped: false });

  async function run(label: string, action: () => Promise<unknown>) {
    setError(null);
    setBusy(label);
    try {
      await action();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not go through");
    } finally {
      setBusy(null);
    }
  }

  const cancel = () =>
    run("Check your wallet", () =>
      callContract({
        receiverId: contractId,
        methodName: "cancel_invoice",
        args: { id: invoice.id },
      }),
    );

  const close = () =>
    run("Check your wallet", () =>
      callContract({
        receiverId: contractId,
        methodName: "close_invoice",
        args: { id: invoice.id },
      }),
    );

  const unlist = () =>
    run("Check your wallet", () =>
      callContract({
        receiverId: contractId,
        methodName: "unlist_invoice",
        args: { id: invoice.id },
      }),
    );

  async function list() {
    let asking: bigint;
    try {
      asking = parseAmount(price);
    } catch (cause) {
      setError(cause instanceof MoneyError ? cause.message : "Enter a price");
      return;
    }
    // The contract refuses a price at or above the unpaid balance, since nobody should
    // pay more than the invoice can ever return. Say so here rather than let the wallet
    // prompt and fail.
    if (asking >= owed) {
      setError(`Ask less than ${formatAmount(owed)} USDC, or there is nothing in it for a buyer.`);
      return;
    }
    await run("Check your wallet", () =>
      callContract({
        receiverId: contractId,
        methodName: "list_invoice",
        args: { id: invoice.id, price: asking.toString() },
      }),
    );
  }

  async function rotateInvite() {
    // A fresh keypair, which kills the old link. Done here so the new private half never
    // reaches a server, exactly as at issue time.
    const invite = generateInviteKey();
    await run("Check your wallet", async () => {
      await callContract({
        receiverId: contractId,
        methodName: "rotate_invite",
        args: { id: invoice.id, new_invite_pk: invite.publicKey },
      });
      setRotatedLink(inviteLink(window.location.origin, invoice.id, invite.secretKey));
    });
  }

  if (rotatedLink) {
    return (
      <section>
        <h2 className="text-base">New invite link</h2>
        <p className="mt-2 max-w-[52ch] text-sm text-ink-soft">
          The old link no longer works. This one is shown once and is not stored anywhere,
          so copy it now.
        </p>
        <code className="mt-3 block overflow-x-auto border border-rule bg-sheet px-3 py-2 text-xs">
          {rotatedLink}
        </code>
        <button
          type="button"
          className="mt-3 border border-stamp-blue bg-stamp-blue px-3 py-2 text-xs text-sheet hover:opacity-90"
          onClick={() => void navigator.clipboard.writeText(rotatedLink)}
        >
          Copy link
        </button>
      </section>
    );
  }

  const actions: React.ReactNode[] = [];

  if (roles.isIssuer && invoice.stored_status === "Issued" && invoice.paid === "0") {
    actions.push(
      <Button key="cancel" onClick={cancel} busy={busy} tone="danger">
        Cancel invoice
      </Button>,
    );
  }

  if (roles.isIssuer && invoice.stored_status === "Issued") {
    actions.push(
      <Button key="rotate" onClick={rotateInvite} busy={busy}>
        Replace the invite link
      </Button>,
    );
  }

  if (roles.isHolder && tradable && invoice.listing === null) {
    actions.push(
      <div key="list" className="flex w-full flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[12rem]">
          <span className="text-xs text-ink-soft">
            Sell it for, in USDC. You collect this now instead of{" "}
            <Amount value={owed} /> later.
          </span>
          <input
            className="mt-1 w-full border border-rule bg-sheet px-3 py-2 text-sm tabular outline-none focus:border-stamp-blue"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder={suggestedPrice}
            inputMode="decimal"
          />
        </label>
        <Button onClick={list} busy={busy} tone="market">
          List for sale
        </Button>
      </div>,
    );
  }

  if (roles.isHolder && invoice.listing !== null) {
    actions.push(
      <Button key="unlist" onClick={unlist} busy={busy}>
        Take it off the market
      </Button>,
    );
  }

  // Closing returns the storage deposit. The issuer closes a void invoice; the holder
  // closes a settled one, because by then they may have bought it.
  const mayClose =
    isFinal &&
    ((invoice.stored_status === "Paid" && roles.isHolder) ||
      (invoice.stored_status !== "Paid" && roles.isIssuer));
  if (mayClose) {
    actions.push(
      <Button key="close" onClick={close} busy={busy}>
        Close and reclaim the deposit
      </Button>,
    );
  }

  if (actions.length === 0 && !error) {
    return (
      <p className="text-xs text-ink-soft">
        Nothing to do here right now.
        {invoice.stored_status === "Issued"
          ? " Waiting for the client to accept."
          : null}
      </p>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-end gap-3">{actions}</div>
      {error ? (
        <p className="mt-3 border border-stamp-red bg-sheet p-3 text-xs text-stamp-red">
          {error}
        </p>
      ) : null}
    </section>
  );
}

