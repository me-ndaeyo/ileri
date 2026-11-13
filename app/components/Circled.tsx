/**
 * A figure with a pen circled round it.
 *
 * The app is almost entirely ink on paper, which is right for a ledger and leaves it
 * reading flat. This is the accent: one circled thing per screen, in oxblood, round the
 * number that screen is actually about.
 *
 * It is drawn as a deliberately imperfect ellipse that overshoots where it closes, the
 * way a ring drawn by hand on a paper invoice does. A clean ellipse would read as a
 * border and say nothing; an overshot one reads as somebody having marked it.
 *
 * Decorative, so the ring is hidden from the accessibility tree. The number inside is
 * ordinary text and is announced normally.
 */
export function Circled({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`relative inline-block px-3 py-1 ${className}`}>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full text-stamp-red"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        {/* Starts low-left, round and back past the start, so the ends cross rather than
            meet. vector-effect keeps the stroke an even hairline however far the box is
            stretched, which it is: preserveAspectRatio is none. */}
        <path
          d="M14 74 C2 58 6 26 30 14 C54 2 92 8 97 34 C101 58 78 88 46 92 C28 94 14 88 9 76"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          opacity="0.85"
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}
