"use client";

import { useMemo, useState } from "react";
import { Amount } from "@/components/Amount";
import { Button } from "@/components/Button";
import { parseAmount, MoneyError } from "@/lib/money";
import {
  canonicalize,
  documentHashBase64,
  validateDocument,
  type InvoiceDocument,
  type InvoiceLine,
} from "@/lib/invoice";
import { generateInviteKey, inviteLink } from "@/lib/invite";
import { callContract, returnedValue } from "@/lib/wallet";

interface DraftLine {
  description: string;
  amount: string;
}

/**
 * Issue an invoice.
 *
 * The order of operations matters, and it is the reverse of what feels natural. The
 * document is stored *before* the mint, because the mint carries its hash and a hash
 * means nothing without the document behind it. Then the draft is bound to the invoice
 * id afterwards, once the chain has confirmed which id it got.
 *
 * The invite private key never leaves this component except inside the link, and the
 * link is shown once. If the issuer loses it they rotate the invite rather than recover
 * the key, because nothing stored it.
 */
export function NewInvoiceForm({
  accountId,
  contractId,
  tokenId,
}: {
  accountId: string;
  contractId: string;
  tokenId: string;
}) {
  const [issuerName, setIssuerName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [lines, setLines] = useState<DraftLine[]>([{ description: "", amount: "" }]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ id: string; link: string } | null>(null);

  // Totals recompute as you type, and a bad amount is reported inline rather than on
  // submit, so nobody fills a whole form to be told the first field was wrong.
  const { total, lineErrors } = useMemo(() => {
    const errors: (string | null)[] = [];
    let sum = 0n;
    for (const line of lines) {
      if (line.amount.trim() === "") {
        errors.push(null);
        continue;
      }
      try {
        sum += parseAmount(line.amount);
        errors.push(null);
      } catch (cause) {
        errors.push(cause instanceof MoneyError ? cause.message : "Not a valid amount");
      }
    }
    return { total: sum, lineErrors: errors };
  }, [lines]);

  async function issue() {
    setError(null);

    try {
      const document: InvoiceDocument = {
        version: "1",
        issuer: { accountId, name: issuerName.trim() || accountId },
        client: {
          name: clientName.trim(),
          ...(clientEmail.trim() ? { email: clientEmail.trim() } : {}),
        },
        lines: lines
          .filter((line) => line.description.trim() || line.amount.trim())
          .map<InvoiceLine>((line) => ({
            description: line.description.trim(),
            amount: parseAmount(line.amount).toString(),
          })),
        total: total.toString(),
        token: tokenId,
        dueDate: toNanoseconds(dueDate),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        createdAt: `${Date.now()}000000`,
      };

      // Fails loudly before anything is stored or signed.
      validateDocument(document);

      // Serialize once and send that exact string. Re-serializing on the server could
      // produce different bytes and so a different hash from the one going onchain.
      const canonical = canonicalize(document);
      const docHash = documentHashBase64(document);

      setBusy("Saving the invoice");
      const draftResponse = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: canonical, docHash }),
      });
      if (!draftResponse.ok) {
        throw new Error((await errorText(draftResponse)) ?? "Could not save the invoice");
      }
      const { draftId } = (await draftResponse.json()) as { draftId: string };

      // The invite key is made here and only here. The private half goes into the link.
      const invite = generateInviteKey();

      setBusy("Check your wallet");
      const outcome = await callContract({
        receiverId: contractId,
        methodName: "create_invoice",
        args: {
          invite_pk: invite.publicKey,
          token: tokenId,
          amount: total.toString(),
          due_date: toNanoseconds(dueDate),
          doc_hash: docHash,
        },
        gas: "100000000000000",
        // Covers this invoice's storage plus one token registration. The contract
        // refunds whatever is left over.
        deposit: "50000000000000000000000",
      });

      const invoiceId = returnedValue(outcome);
      if (!invoiceId) {
        throw new Error(
          "The invoice may have been created but its id could not be read. Check your dashboard.",
        );
      }

      setBusy("Linking the invoice");
      // Best effort. If this fails the invoice exists and is valid; only the file is
      // unattached, which is recoverable, so it must not look like the mint failed.
      await fetch("/api/drafts/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId, invoiceId }),
      }).catch(() => undefined);

      setIssued({
        id: invoiceId,
        link: inviteLink(window.location.origin, invoiceId, invite.secretKey),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (issued) return <IssuedPanel id={issued.id} link={issued.link} />;

  const canIssue =
    !busy &&
    clientName.trim() !== "" &&
    total > 0n &&
    lineErrors.every((e) => e === null) &&
    lines.some((line) => line.description.trim() && line.amount.trim());

  return (
    <form
      className="mt-8"
      onSubmit={(event) => {
        event.preventDefault();
        void issue();
      }}
    >
      <Field label="Your name or business" hint="Shown on the invoice. Not stored on chain.">
        <input
          className={inputClass}
          value={issuerName}
          onChange={(e) => setIssuerName(e.target.value)}
          placeholder={accountId}
        />
      </Field>

      <Field label="Who is it for" hint="Offchain only. The client binds their own account when they accept.">
        <input
          className={inputClass}
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Acme Ltd"
          required
        />
      </Field>

      <Field label="Their email" hint="Optional, and only so you remember who you sent it to.">
        <input
          className={inputClass}
          type="email"
          value={clientEmail}
          onChange={(e) => setClientEmail(e.target.value)}
        />
      </Field>

      <Field label="Due date">
        <input
          className={inputClass}
          type="date"
          value={dueDate}
          min={tomorrow()}
          onChange={(e) => setDueDate(e.target.value)}
          required
        />
      </Field>

      <fieldset className="mt-6 border-t border-rule pt-4">
        <legend className="text-xs text-ink-soft">What you are billing for</legend>
        {lines.map((line, index) => (
          <div key={index} className="mt-3 flex flex-wrap items-start gap-2">
            <input
              className={`${inputClass} flex-1 min-w-[12rem]`}
              value={line.description}
              onChange={(e) => updateLine(setLines, index, { description: e.target.value })}
              placeholder="Brand design"
            />
            <div>
              <input
                className={`${inputClass} w-32 text-right tabular`}
                value={line.amount}
                onChange={(e) => updateLine(setLines, index, { amount: e.target.value })}
                placeholder="800.00"
                inputMode="decimal"
              />
              {lineErrors[index] ? (
                <p className="mt-1 text-xs text-stamp-red">{lineErrors[index]}</p>
              ) : null}
            </div>
            {lines.length > 1 ? (
              <button
                type="button"
                className="border border-rule px-2 py-2 text-xs hover:bg-paper"
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
                aria-label={`Remove line ${index + 1}`}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}

        <button
          type="button"
          className="mt-3 border border-rule px-3 py-1.5 text-xs hover:bg-paper"
          onClick={() => setLines([...lines, { description: "", amount: "" }])}
        >
          Add a line
        </button>
      </fieldset>

      <Field label="Notes" hint="Optional. Payment terms, a reference, anything they need.">
        <textarea
          className={`${inputClass} h-20`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <div className="mt-6 flex items-baseline justify-between border-t border-rule pt-4">
        <span className="text-sm">Total</span>
        <span className="text-base">
          <Amount value={total} symbol="USDC" />
        </span>
      </div>

      {error ? (
        <p className="mt-4 border border-stamp-red bg-sheet p-3 text-xs text-stamp-red">
          {error}
        </p>
      ) : null}

      <Button type="submit" busy={busy} disabled={!canIssue} tone="primary" className="mt-6">
        Create invoice
      </Button>

      <p className="mt-3 text-xs text-ink-soft">
        Creating an invoice costs a small deposit for storage, which you get back when the
        invoice is closed. The amount, your account and the due date become public on
        chain; the names, lines and notes stay encrypted offchain.
      </p>
    </form>
  );
}

/** The one time the invite link is ever shown. */
function IssuedPanel({ id, link }: { id: string; link: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-8">
      <p className="text-base">Invoice {id} created</p>
      <p className="mt-2 max-w-[52ch] text-sm text-ink-soft">
        Send this link to your client. It is the only way they can accept the invoice, and
        it is shown once: the key in it is not stored anywhere, not even by us. If you lose
        it, rotate the invite from the invoice page and send a new one.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="flex-1 min-w-[16rem] overflow-x-auto border border-rule bg-sheet px-3 py-2 text-xs">
          {link}
        </code>
        <button
          type="button"
          className="border border-stamp-blue bg-stamp-blue px-3 py-2 text-xs text-sheet hover:opacity-90"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <div className="mt-6 flex gap-3">
        <a href={`/app/invoice/${id}`} className="border border-rule px-4 py-2 text-sm hover:bg-paper">
          View the invoice
        </a>
        <a href="/app" className="border border-rule px-4 py-2 text-sm hover:bg-paper">
          Back to your invoices
        </a>
      </div>
    </div>
  );
}

const inputClass =
  "mt-1 w-full border border-rule bg-sheet px-3 py-2 text-sm outline-none focus:border-stamp-blue";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-6 block">
      <span className="text-sm">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-soft">{hint}</span> : null}
    </label>
  );
}

/** The server's own words for a failure, when it gave any. */
async function errorText(response: Response): Promise<string | null> {
  try {
    const { error } = (await response.json()) as { error?: string };
    return error ?? null;
  } catch {
    return null;
  }
}

function updateLine(
  setLines: React.Dispatch<React.SetStateAction<DraftLine[]>>,
  index: number,
  patch: Partial<DraftLine>,
) {
  setLines((lines) => lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
}

/** A date input gives `yyyy-mm-dd`; the contract wants nanoseconds. */
function toNanoseconds(date: string): string {
  // End of that day, so an invoice due "30 Nov" is not overdue at one minute past
  // midnight in some other timezone.
  return `${new Date(`${date}T23:59:59Z`).getTime()}000000`;
}

function defaultDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

