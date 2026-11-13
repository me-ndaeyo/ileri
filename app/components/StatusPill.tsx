import type { StatusView } from "@/lib/near";

/**
 * Status in a list. The full ink stamp is reserved for the invoice sheet itself, so this
 * is its quiet cousin, using the same colours.
 */
const STYLES: Record<StatusView, string> = {
  Issued: "border-rule text-ink",
  Accepted: "border-stamp-blue text-stamp-blue",
  PartiallyPaid: "border-stamp-blue text-stamp-blue",
  Paid: "border-stamp-green text-stamp-green",
  Rejected: "border-ink text-ink",
  Overdue: "border-stamp-red text-stamp-red",
  // Cancelled reads as struck through and faded, per the design.
  Cancelled: "border-rule text-ink-faint line-through",
};

/** Sentence case, plain words. An action keeps one name through the whole flow. */
const WORDS: Record<StatusView, string> = {
  Issued: "Issued",
  Accepted: "Accepted",
  PartiallyPaid: "Partially paid",
  Paid: "Paid",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
  Overdue: "Overdue",
};

export function StatusPill({ status }: { status: StatusView }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-xs ${STYLES[status]}`}
      // The derived statuses are the ones worth explaining.
      title={status === "Overdue" ? "Past its due date and not yet paid" : undefined}
    >
      {WORDS[status]}
    </span>
  );
}
