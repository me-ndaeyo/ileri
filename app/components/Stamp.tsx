import type { StatusView } from "@/lib/near";

/**
 * The invoice's status, as an ink stamp pressed onto the sheet.
 *
 * This is the one bold element in the whole design; everything else stays quiet. Rotated
 * a few degrees and slightly transparent so it reads as ink on paper rather than a badge
 * bolted on.
 */
const COLOUR: Record<StatusView, string> = {
  Issued: "text-ink border-ink",
  Accepted: "text-stamp-blue border-stamp-blue",
  PartiallyPaid: "text-stamp-blue border-stamp-blue",
  Paid: "text-stamp-green border-stamp-green",
  Rejected: "text-ink border-ink",
  Cancelled: "text-ink/50 border-ink/50",
  Overdue: "text-stamp-red border-stamp-red",
};

const WORDS: Record<StatusView, string> = {
  Issued: "Issued",
  Accepted: "Accepted",
  PartiallyPaid: "Part paid",
  Paid: "Paid",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
  Overdue: "Overdue",
};

export function Stamp({ status }: { status: StatusView }) {
  return (
    <span
      // `stamp-press` is defined in globals.css and disabled under reduced motion.
      className={`stamp-press inline-block -rotate-3 border-2 px-4 py-1 text-base tracking-wide opacity-80 ${COLOUR[status]}`}
      role="status"
    >
      {WORDS[status]}
    </span>
  );
}
