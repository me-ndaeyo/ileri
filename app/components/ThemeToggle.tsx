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
   colour, so they invert with the selected state for free, and they add no request.
   Drawn on a 24 grid at 1.6 stroke to sit with the hairlines everywhere else. */
const OPTIONS = [
  {
    value: "light" as const,
    label: "Light",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
      </svg>
    ),
  },
  {
    value: "system" as const,
    label: "Follow my system",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <rect x="2.8" y="4.2" width="18.4" height="12.4" rx="1.4" />
        <path d="M8.6 20.4h6.8M12 16.6v3.8" />
      </svg>
    ),
  },
  {
    value: "dark" as const,
    label: "Dark",
    icon: (
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
        <path d="M20.4 14.6A8.6 8.6 0 1 1 9.4 3.6a6.9 6.9 0 0 0 11 11Z" />
      </svg>
    ),
  },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, read, readOnServer);

  return (
    <fieldset
      className={`inline-flex items-center border border-rule ${className}`}
      aria-label="Theme"
    >
      {OPTIONS.map(({ value, label, icon }) => {
        const active = choice === value;
        return (
          <label
            key={value}
            title={label}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center ${
              active ? "bg-ink text-sheet" : "text-ink-soft hover:text-ink"
            }`}
          >
            {/* A real radio group, so it is one tab stop and the arrow keys move between
                the options, rather than three buttons that each need their own tab. */}
            <input
              type="radio"
              name="theme"
              className="sr-only"
              checked={active}
              onChange={() => write(value)}
            />
            {icon}
            {/* The icons carry no text, so the name has to reach a screen reader some
                other way. `title` alone would not: it is a tooltip, not a label. */}
            <span className="sr-only">{label}</span>
          </label>
        );
      })}
    </fieldset>
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
