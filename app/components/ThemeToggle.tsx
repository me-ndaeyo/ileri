"use client";

import { useSyncExternalStore } from "react";

type Choice = "light" | "dark" | "system";

const KEY = "ileri-theme";

/**
 * Light, dark, or whatever the system says.
 *
 * Three states rather than two, because two cannot express "follow my machine", which is
 * the state most people want and the one that should be the default. A two-way switch
 * would silently pin whichever it happened to start on.
 *
 * The choice is not kept in React state. It lives in `localStorage` and on the document
 * element, and this subscribes to that rather than mirroring it: holding a copy in state
 * means reading the store in an effect, which is a render after paint and a flash of the
 * wrong label. `useSyncExternalStore` is the tool for exactly this, and it also gets
 * cross-tab sync for free, since another tab's change arrives as a `storage` event.
 *
 * The attribute is read by three selectors in globals.css: the media query for the system
 * default, `:not([data-theme="light"])` so an explicit light beats a dark system, and
 * `[data-theme="dark"]` so an explicit dark beats a light system.
 */

/** Same-tab listeners. A `storage` event only fires in the tabs that did not change it. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): Choice {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // A private window, or site data blocked. The theme still follows the system, it
    // just cannot be remembered, which is not worth taking the page down for.
    return "system";
  }
}

/** During prerender and hydration there is no storage to read, so: follow the system. */
function readOnServer(): Choice {
  return "system";
}

function write(next: Choice): void {
  const root = document.documentElement;
  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);

  try {
    if (next === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, next);
  } catch {
    // Applied but not remembered. Better than refusing to change at all.
  }
  for (const listener of listeners) listener();
}


/* Inline stroke SVGs rather than an icon font or emoji: they take the current text
   colour, so they need no variants, and they add no request. Drawn on a 24 grid at 1.6
   stroke to sit with the hairlines everywhere else. */
const SUN = (
  <>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
  </>
);

const MOON = <path d="M20.4 14.6A8.6 8.6 0 1 1 9.4 3.6a6.9 6.9 0 0 0 11 11Z" />;

const SCREEN = (
  <>
    <rect x="2.8" y="4.2" width="18.4" height="12.4" rx="1.4" />
    <path d="M8.6 20.4h6.8M12 16.6v3.8" />
  </>
);

/**
 * The cycle. One control showing the state it is in, advancing on each press.
 *
 * Three radios side by side were three times the width for a setting touched once, which
 * is a poor trade in a header and a worse one in a phone bar. System sits last rather
 * than in the middle, so the two states somebody actually chooses between are adjacent.
 */
const CYCLE = [
  { value: "light" as const, name: "Light", icon: SUN },
  { value: "dark" as const, name: "Dark", icon: MOON },
  { value: "system" as const, name: "Follow my system", icon: SCREEN },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, read, readOnServer);

  const index = CYCLE.findIndex((step) => step.value === choice);
  const now = CYCLE[index === -1 ? 2 : index];
  const next = CYCLE[(CYCLE.indexOf(now) + 1) % CYCLE.length];

  return (
    <button
      type="button"
      onClick={() => write(next.value)}
      // A cycling control has to say both halves: what it is now, and what pressing it
      // does. Without the second half somebody using a screen reader has to press it to
      // find out, which is the whole problem with a cycle.
      aria-label={`Theme: ${now.name}. Switch to ${next.name}`}
      title={`Theme: ${now.name}`}
      className={`flex h-9 w-9 items-center justify-center border border-rule text-ink-soft hover:text-ink ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {now.icon}
      </svg>
    </button>
  );
}

/**
 * Applied in the head, before the first paint.
 *
 * Deliberately tiny and synchronous. Anything that runs after paint gives a flash of the
 * wrong theme, which is worse than having no toggle at all. The try/catch is because
 * reading localStorage throws outright in some privacy modes.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
