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

export function ThemeToggle({ className = "" }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, read, readOnServer);

  return (
    <fieldset
      className={`inline-flex items-center border border-rule ${className}`}
      aria-label="Theme"
    >
      {(["light", "system", "dark"] as const).map((option) => {
        const active = choice === option;
        return (
          <label
            key={option}
            className={`cursor-pointer px-2 py-1 text-xs capitalize ${
              active ? "bg-ink text-sheet" : "text-ink/60 hover:text-ink"
            }`}
          >
            {/* A real radio group, so it is one tab stop and the arrow keys move between
                the options, rather than three buttons that each need their own tab. */}
            <input
              type="radio"
              name="theme"
              className="sr-only"
              checked={active}
              onChange={() => write(option)}
            />
            {option}
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
