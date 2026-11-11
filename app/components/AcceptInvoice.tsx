"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Amount } from "@/components/Amount";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Stamp } from "@/components/Stamp";
import { documentHashBase64, type InvoiceDocument } from "@/lib/invoice";
import { decodeSecret, signInviteMessage } from "@/lib/invite";
import { callContract } from "@/lib/wallet";
import type { InvoiceView } from "@/lib/near";

type Phase = "reading" | "ready" | "working" | "accepted" | "rejected";

/**
 * Review an invoice from an invite link, then accept or reject it.
 *
 * The invite key arrives in the URL fragment, which is the one part of a URL browsers
 * never send to a server. It is read once on mount and immediately stripped from the
 * address bar, so it does not sit in history, get copied out of the location field, or
 * leak through a Referer header. It is held in a ref rather than state, because state
 * ends up in React's serialized tree.
 */
export function AcceptInvoice({
  invoice,
  accountId,
  contractId,
}: {
  invoice: InvoiceView;
  accountId: string | null;
  contractId: string;
}) {
  const secret = useRef<Uint8Array | null>(null);
  const [phase, setPhase] = useState<Phase>("reading");
  const [document, setDocument] = useState<InvoiceDocument | null>(null);
  const [hashMatches, setHashMatches] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const loadDocument = useCallback(
    async (secretKey: Uint8Array) => {
      try {
        const challengeResponse = await fetch("/api/invite/challenge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ invoiceId: invoice.id }),
        });
        if (!challengeResponse.ok) throw new Error("Could not check this link");
        const { nonce, challenge } = (await challengeResponse.json()) as {
          nonce: string;
          challenge: string;
        };

        const verifyResponse = await fetch("/api/invite/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            invoiceId: invoice.id,
            nonce,
            signature: signInviteMessage(secretKey, challenge),
          }),
        });
        if (!verifyResponse.ok) {
          throw new Error(
            ((await verifyResponse.json().catch(() => ({}))) as { error?: string }).error ??
              "This invite link is not valid",
          );
        }
        const { token } = (await verifyResponse.json()) as { token: string };

        const fileResponse = await fetch(`/api/invoices/${invoice.id}/file`, {
          headers: { "x-ileri-invite": token },
        });
        if (fileResponse.ok) {
          const { document: raw } = (await fileResponse.json()) as { document: string };
          const parsed = JSON.parse(raw) as InvoiceDocument;
          setDocument(parsed);
          // Re-hash in the browser and compare with the chain, so the client is not
          // taking our word that this document is the one the invoice was signed for.
          setHashMatches(documentHashBase64(parsed) === invoice.doc_hash);
        }
        setPhase("ready");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not read this invoice");
        setPhase("ready");
      }
    },
    [invoice.id, invoice.doc_hash],
  );

  useEffect(() => {
    // An async body so the state updates below are not synchronous within the effect,
    // which React now rightly objects to. Everything before the first `await` still runs
    // in this same tick, so the key is stripped from the address bar immediately.
    void (async () => {
      const key = new URLSearchParams(window.location.hash.slice(1)).get("k");

      // Strip it before anything else can read it: not into history, not copied out of
      // the location field, not into a Referer header.
      if (key) {
        window.history.replaceState(null, "", window.location.pathname);
      }

      if (!key) {
        setError("This link is missing its key. Ask the sender for the full link.");
        setPhase("ready");
        return;
      }

      let decoded: Uint8Array;
      try {
        decoded = decodeSecret(key);
      } catch {
        setError("This link is not valid.");
        setPhase("ready");
        return;
      }

      // A ref, not state: state ends up in React's serialized tree.
      secret.current = decoded;
      await loadDocument(decoded);
    })();
  }, [loadDocument]);

  async function act(action: "accept" | "reject") {
    if (!accountId) {
      setError("Connect a wallet first.");
      return;
    }
    if (!secret.current) {
      setError("This link is missing its key.");
      return;
    }

    setError(null);
    setPhase("working");
    try {
      // The message to sign always comes from the contract, never rebuilt here.
      const message = await fetch(
        `/api/invite/message?id=${invoice.id}&account=${encodeURIComponent(accountId)}&action=${action}`,
      ).then(async (response) => {
        if (!response.ok) throw new Error("Could not prepare the signature");
        return ((await response.json()) as { message: string }).message;
      });

      const signature = signInviteMessage(secret.current, message);

      await callContract({
        receiverId: contractId,
        methodName: action === "accept" ? "accept_invoice" : "reject_invoice",
        args:
          action === "accept"
            ? { id: invoice.id, invite_sig: signature }
            : {
                id: invoice.id,
                reason_hash: reason.trim() ? await hashReason(reason.trim()) : null,
                invite_sig: signature,
              },
      });

      setPhase(action === "accept" ? "accepted" : "rejected");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not go through");
      setPhase("ready");
    }
  }

  if (phase === "accepted") {
    return (
      <Done
        title="Invoice accepted"
        body="The issuer can see that you accepted it. You can pay it whenever you are ready, and whoever holds the invoice receives the money."
        invoiceId={invoice.id}
      />
    );
  }

  if (phase === "rejected") {
    return (
      <Done
        title="Invoice rejected"
        body="The issuer can see that you rejected it. Nothing was charged."
        invoiceId={invoice.id}
      />
    );
  }

  return (
    <div className="mt-6">
      <article className="border border-rule bg-sheet">
        <header className="border-b border-rule px-5 py-3">
          <p className="text-xs text-ink/60">From</p>
          <p className="text-base">{document?.issuer.name ?? invoice.issuer}</p>
        </header>

        <div className="flex items-baseline justify-between gap-4 px-5 pt-4">
          <h2 className="text-lg">Invoice {invoice.id}</h2>
          <p className="text-xs text-ink/60">Due {formatDate(invoice.due_date)}</p>
        </div>

        {phase === "reading" ? (
          <p className="px-5 py-6 text-xs text-ink/60">Checking your link…</p>
        ) : document ? (
          <>
            <dl className="mt-4 border-t border-rule">
              {document.lines.map((line, index) => (
                <Row key={index} label={line.description}>
                  <Amount value={line.amount} />
                </Row>
              ))}
            </dl>
            {document.notes ? (
              <p className="border-t border-rule px-5 py-3 text-xs text-ink/70">{document.notes}</p>
            ) : null}
          </>
        ) : (
          <p className="border-t border-rule px-5 py-4 text-xs text-ink/60">
            The invoice details are not available, but the amount and due date below come
            straight from the chain.
          </p>
        )}

        <div className="flex items-baseline justify-between border-t border-rule px-5 py-3">
          <span className="text-sm">Total due</span>
          <span className="text-base">
            <Amount value={invoice.amount} symbol="USDC" />
          </span>
        </div>

        <div className="flex items-center justify-end px-5 py-5">
          <Stamp status={invoice.status} />
        </div>
      </article>

      {hashMatches !== null ? (
        <p className={`mt-3 text-xs ${hashMatches ? "text-stamp-green" : "text-stamp-red"}`}>
          {hashMatches
            ? "These details match what is recorded on chain."
            : "Warning: these details do not match what is recorded on chain. Do not accept this invoice."}
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 border border-stamp-red/40 bg-sheet p-3 text-xs text-stamp-red">
          {error}
        </p>
      ) : null}

      {invoice.status !== "Issued" ? (
        <p className="mt-6 border border-rule bg-sheet p-4 text-xs text-ink/60">
          This invoice is {invoice.status.toLowerCase()}, so there is nothing to decide.
        </p>
      ) : !accountId ? (
        <div className="mt-6">
          <p className="mb-3 max-w-[48ch] text-sm text-ink/70">
            Connect a NEAR wallet to accept or reject. Accepting records that you agreed to
            this invoice; it does not pay it.
          </p>
          <ConnectWallet accountId={null} />
        </div>
      ) : (
        <div className="mt-6">
          <p className="text-xs text-ink/60">Signed in as {accountId}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={phase === "working" || hashMatches === false}
              onClick={() => void act("accept")}
              className="border border-stamp-blue bg-stamp-blue px-4 py-2 text-sm text-sheet hover:opacity-90 disabled:opacity-50"
            >
              {phase === "working" ? "Check your wallet…" : "Accept invoice"}
            </button>
            <button
              type="button"
              disabled={phase === "working"}
              onClick={() => void act("reject")}
              className="border border-stamp-red px-4 py-2 text-sm text-stamp-red hover:bg-paper disabled:opacity-50"
            >
              Reject invoice
            </button>
          </div>
          <label className="mt-4 block">
            <span className="text-xs text-ink/60">
              If you reject it, why? Optional, and kept offchain.
            </span>
            <input
              className="mt-1 w-full border border-rule bg-sheet px-3 py-2 text-sm outline-none focus:border-stamp-blue"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Done({ title, body, invoiceId }: { title: string; body: string; invoiceId: string }) {
  return (
    <div className="mt-8">
      <p className="text-base">{title}</p>
      <p className="mt-2 max-w-[52ch] text-sm text-ink/70">{body}</p>
      <a
        href={`/pay/${invoiceId}`}
        className="mt-6 inline-block border border-rule px-4 py-2 text-sm hover:bg-paper"
      >
        Pay this invoice
      </a>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule px-5 py-2.5 last:border-0">
      <dt className="text-sm">{label}</dt>
      <dd className="text-sm tabular">{children}</dd>
    </div>
  );
}

/** Only the hash of a reason goes onchain; the text stays offchain. */
async function hashReason(reason: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reason));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function formatDate(ns: string): string {
  return new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

