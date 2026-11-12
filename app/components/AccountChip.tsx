/**
 * A NEAR account, with a disc in its own colour.
 *
 * Account ids are long, similar to each other and easy to misread, and on this app
 * misreading one means misreading who gets paid. The disc is derived from the id, so the
 * same account is the same colour on every screen and a change of holder is visible
 * before the text is read.
 *
 * The colours are the brand's own inks rather than a generated hue, so a chip can never
 * clash with the page or imply a status it does not have. Five is enough to tell the two
 * or three accounts on any one screen apart, which is all this is for. It is decoration
 * and an aid, never identification: the id beside it is the truth.
 */

const INKS = [
  "var(--stamp-red)",
  "var(--stamp-blue)",
  "var(--stamp-green)",
  "var(--gold)",
  "var(--ink-soft)",
] as const;

/**
 * Deterministic, and cheap. Not a cryptographic hash and not trying to be: the only
 * requirement is that the same id always lands on the same ink.
 */
function inkFor(accountId: string): string {
  let hash = 0;
  for (let i = 0; i < accountId.length; i += 1) {
    hash = (hash * 31 + accountId.charCodeAt(i)) % 100_003;
  }
  return INKS[hash % INKS.length];
}

export function AccountChip({
  accountId,
  note,
  className = "",
}: {
  accountId: string;
  /** What this account is to the thing on screen: "you", "bought it", "the client". */
  note?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 border border-rule bg-paper py-1 pl-1.5 pr-3 ${className}`}
    >
      <span
        className="h-4 w-4 flex-none rounded-full opacity-85"
        style={{ background: inkFor(accountId) }}
        aria-hidden="true"
      />
      <span className="font-mono text-xs">{accountId}</span>
      {note ? <span className="text-xs text-ink/60">{note}</span> : null}
    </span>
  );
}
