import { formatAmount } from "@/lib/money";

/**
 * Money on screen.
 *
 * Tabular figures and right alignment so a column of amounts lines up and does not
 * jitter as values change. Always rendered through `formatAmount`, never interpolated
 * directly, so no screen can invent its own rounding.
 */
export function Amount({
  value,
  symbol,
  className = "",
}: {
  value: string | bigint;
  symbol?: string;
  className?: string;
}) {
  return (
    <span className={`tabular ${className}`}>
      {formatAmount(value)}
      {symbol ? <span className="text-ink-soft"> {symbol}</span> : null}
    </span>
  );
}
