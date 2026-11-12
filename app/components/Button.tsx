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

const TONES = {
  /** The one thing this screen is for. One per view. */
  primary: "border-ink bg-ink text-sheet hover:opacity-90",
  /** An action that is available but not the point of the screen. */
  secondary: "border-ink bg-transparent hover:bg-paper",
  /** Cancelling, rejecting, anything that destroys. Never the primary. */
  danger: "border-stamp-red bg-transparent text-stamp-red hover:bg-paper",
  /** Listing for sale, which is the market and so gold. */
  market: "border-gold bg-gold text-sheet hover:opacity-90",
} as const;

export function Button({
  onClick,
  busy,
  disabled,
  tone = "secondary",
  type = "button",
  className = "",
  children,
}: {
  onClick?: () => void | Promise<void>;
  /** The label while waiting. Also disables the control and marks it busy. */
  busy?: string | null;
  disabled?: boolean;
  tone?: keyof typeof TONES;
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
      className={`min-h-11 border px-4 py-2 text-sm disabled:opacity-50 ${TONES[tone]} ${className}`}
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
