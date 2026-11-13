"use client";

/**
 * Every action in the app, and the one place a waiting action is drawn.
 *
 * Almost all of these wait on a wallet, which is a human picking up another window and
 * approving something. That wait is seconds, not milliseconds, so it has to be shown on
 * the control that caused it rather than as a line of text further down the page where
 * nobody is looking.
 *
 * `busy` is the label to show while waiting, not a boolean, because the useful thing to
 * say is what is being waited on. "Check your wallet" is a different message from
 * "Reading the contract", and the person needs the first one to know to go and look.
 *
 * The label is paired with a spinner. On its own a changing label says what is happening
 * but says it statically, and a wallet prompt can take seconds: without motion people
 * press again or assume it failed. Under reduced motion the ring becomes a static dot,
 * which still marks the control as busy without pretending to show progress.
 */

/**
 * Sizes, as whole sets.
 *
 * A caller cannot pass `min-h-7` through `className` to shrink the default, because both
 * would land on the element and Tailwind resolves a conflict by stylesheet order rather
 * than by the order written in the attribute. Which one wins is then effectively
 * arbitrary. So the size is chosen here and only one set is ever emitted.
 *
 * `compact` goes under the 44px target the design system asks for, so it carries
 * `tap-44`, which extends the touch area without changing the box.
 */
const SIZES = {
  default: "min-h-11 px-4 py-2 text-sm",
  compact:
    "tap-44 min-h-7 px-2 py-1 text-[0.6875rem] sm:min-h-9 sm:px-3 sm:py-1.5 sm:text-xs",
} as const;

const TONES = {
  /**
   * The one thing this screen is for. One per view, and the accent carries it.
   *
   * Ink-filled before, which made the main action the same colour as the body text and
   * gave a screen no focal point at all. Oxblood is the right colour for it here: in this
   * design it is the seal, which reads as authority rather than as alarm.
   */
  primary: "border-stamp-red bg-stamp-red text-sheet hover:opacity-90",
  /** Available, but not the point of the screen. */
  secondary: "border-ink bg-transparent hover:bg-paper",
  /**
   * Cancelling, rejecting, anything that destroys. Never the primary.
   *
   * A neutral border with oxblood text, NOT an oxblood border. Beside a filled-oxblood
   * primary, an outlined-oxblood button reads as the quieter version of the same action,
   * and "Reject invoice" sitting next to "Accept invoice" is the one place in this app
   * where that confusion would be expensive. The fill is what marks the primary; the
   * text colour is what marks the danger.
   */
  danger: "border-rule bg-transparent text-stamp-red hover:bg-paper",
  /** Listing for sale, which is the market and so gold. */
  market: "border-gold bg-gold text-sheet hover:opacity-90",
} as const;

export function Button({
  onClick,
  busy,
  disabled,
  tone = "secondary",
  size = "default",
  type = "button",
  className = "",
  children,
}: {
  onClick?: () => void | Promise<void>;
  /** The label while waiting. Also disables the control and marks it busy. */
  busy?: string | null;
  disabled?: boolean;
  tone?: keyof typeof TONES;
  /** Pick a size here rather than overriding one through `className`. See SIZES. */
  size?: keyof typeof SIZES;
  type?: "button" | "submit";
  className?: string;
  children: React.ReactNode;
}) {
  const waiting = typeof busy === "string" && busy.length > 0;
  return (
    <button
      type={type}
      onClick={onClick ? () => void onClick() : undefined}
      disabled={disabled || waiting}
      // Announced when it flips, so somebody not watching the button still hears that
      // the app is waiting on them.
      aria-busy={waiting || undefined}
      aria-live={waiting ? "polite" : undefined}
      className={`border disabled:opacity-50 ${SIZES[size]} ${TONES[tone]} ${className}`}
    >
      {waiting ? (
        <span className="inline-flex items-center gap-2">
          <span className="spinner" aria-hidden="true" />
          {busy}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * A value that is still being read, inline, at the size of the text around it.
 *
 * For the small facts a panel fetches after it mounts, like a token balance. Without
 * this they pop in and shift the line; with it the space is already held.
 */
export function Pending({ className = "w-24" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3 translate-y-px bg-wash ${className}`}
      role="status"
      aria-label="Still loading"
    />
  );
}
