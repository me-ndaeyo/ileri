"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Amount } from "@/components/Amount";
import { Button } from "@/components/Button";
import { ConnectWallet } from "@/components/ConnectWallet";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { SignOutButton } from "@/components/SignOutButton";
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
      {/* The one sheet implementation, with the decrypted document set inside it. This
          used to be a second hand-built copy of the sheet, which meant the screen a client
          sees first was the only one not drawn as the instrument. */}
      <InvoiceSheet invoice={invoice}>
        {phase === "reading" ? (
          <p className="text-xs text-ink-soft">Checking your link…</p>
        ) : document ? (
          <>
            <p className="text-xs text-ink-soft">Billed to</p>
            <p className="mt-1 text-sm">{document.client.name}</p>

            <div className="mt-5 border-t border-rule">
              <div className="flex gap-4 border-b border-rule py-2.5">
                <span className="flex-1 text-xs text-ink-soft">Description</span>
                <span className="w-28 text-right text-xs text-ink-soft">Amount</span>
              </div>
              {document.lines.map((line, index) => (
                <div key={index} className="flex items-baseline gap-4 border-b border-rule py-2.5">
                  <span className="flex-1 text-sm">{line.description}</span>
                  <span className="tabular w-28 text-right text-sm">
                    <Amount value={line.amount} />
                  </span>
                </div>
              ))}
            </div>

            {document.notes ? (
              <p className="mt-4 max-w-[60ch] text-xs leading-relaxed text-ink-soft">
                {document.notes}
              </p>
            ) : null}
          </>
        ) : (
          <p className="max-w-[60ch] text-xs leading-relaxed text-ink-soft">
            The line items could not be opened, so only what is on chain is shown above.
            The amount and the due date are the chain&apos;s own, and they are what binds.
          </p>
        )}
      </InvoiceSheet>

      {hashMatches !== null ? (
        <p className={`mt-3 text-xs ${hashMatches ? "text-stamp-green" : "text-stamp-red"}`}>
          {hashMatches
            ? "These details match what is recorded on chain."
            : "Warning: these details do not match what is recorded on chain. Do not accept this invoice."}
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 border border-stamp-red bg-sheet p-3 text-xs text-stamp-red">
          {error}
        </p>
      ) : null}

      {invoice.status !== "Issued" ? (
        <p className="mt-6 border border-rule bg-sheet p-4 text-xs text-ink-soft">
          This invoice is {invoice.status.toLowerCase()}, so there is nothing to decide.
        </p>
      ) : !accountId ? (
        <div className="mt-6">
          <p className="mb-3 max-w-[48ch] text-sm text-ink-soft">
            Connect a NEAR wallet to accept or reject. Accepting records that you agreed to
            this invoice; it does not pay it.
          </p>
          <ConnectWallet accountId={null} />
        </div>
      ) : (
        <div className="mt-6">
          <p className="flex flex-wrap items-center gap-3 text-xs text-ink-soft">
            <span>Signed in as {accountId}</span>
            {/* The reason this component needed it: an issuer opening their own invite
                link has to be able to stop being the issuer. */}
            <SignOutButton />
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              onClick={() => act("accept")}
              busy={phase === "working" ? "Check your wallet" : null}
              disabled={hashMatches === false}
              tone="primary"
            >
              Accept invoice
            </Button>
            <Button
              onClick={() => act("reject")}
              busy={phase === "working" ? "Check your wallet" : null}
              tone="danger"
            >
              Reject invoice
            </Button>
          </div>
          <label className="mt-4 block">
            <span className="text-xs text-ink-soft">
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
      <p className="mt-2 max-w-[52ch] text-sm text-ink-soft">{body}</p>
      <a
        href={`/pay/${invoiceId}`}
        className="mt-6 inline-block border border-rule px-4 py-2 text-sm hover:bg-paper"
      >
        Pay this invoice
      </a>
    </div>
  );
}


/** Only the hash of a reason goes onchain; the text stays offchain. */
async function hashReason(reason: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reason));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}


