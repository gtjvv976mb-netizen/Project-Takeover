"use client";
import { useSyncExternalStore } from "react";

/**
 * Light / dark switch.
 *
 * The theme lives in one place — the `data-theme` attribute on <html> — and every colour
 * in the app is a token that reads off it. Nothing here knows about individual components.
 *
 * Three states, not two. "system" is the default and keeps following the OS after the
 * first visit; picking light or dark pins it and writes to localStorage. THEME_SCRIPT in
 * layout.tsx replays that choice before first paint so the page never flashes white.
 */

export type Theme = "light" | "dark" | "system";
const KEY = "takeover-theme";

/**
 * Runs before anything renders, so it cannot import from this module — keep it a string
 * and keep it small. It resolves the stored choice, or the OS preference, and stamps the
 * attribute while the body is still empty.
 */
export const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(KEY)})||"system";
var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.dataset.theme=d?"dark":"light";
document.documentElement.dataset.themeChoice=t;
}catch(e){}})()`;

const EVENT = "takeover-theme-change";

function apply(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themeChoice = t;
}

/**
 * The theme is not React state — it is an attribute on <html>, written before React
 * exists and readable by anything. So subscribe to it rather than mirroring it: this
 * also picks up a change made in another tab for free.
 */
const store = {
  subscribe(onChange: () => void) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      // Only while the visitor has not pinned a side; then the OS switching at dusk
      // carries the page with it.
      if ((document.documentElement.dataset.themeChoice ?? "system") === "system") apply("system");
      onChange();
    };
    mq.addEventListener("change", onSystem);
    addEventListener("storage", onChange);
    addEventListener(EVENT, onChange);
    return () => {
      mq.removeEventListener("change", onSystem);
      removeEventListener("storage", onChange);
      removeEventListener(EVENT, onChange);
    };
  },
  get: (): Theme => (document.documentElement.dataset.themeChoice as Theme) ?? "system",
  // The server cannot know what the browser resolved, so it renders the neutral middle
  // and React swaps in the real choice on hydration.
  getServer: (): Theme => "system",
};

export function ThemeToggle() {
  const choice = useSyncExternalStore(store.subscribe, store.get, store.getServer);

  function pick(t: Theme) {
    apply(t);
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      // private mode: the theme still applies, it just will not survive a reload
    }
    dispatchEvent(new Event(EVENT));
  }

  const opts: { v: Theme; label: string; icon: React.ReactNode }[] = [
    { v: "light", label: "Light", icon: <Sun /> },
    { v: "system", label: "Match system", icon: <Auto /> },
    { v: "dark", label: "Dark", icon: <Moon /> },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-full border border-line bg-bg-2 p-0.5"
    >
      {opts.map((o) => {
        const on = choice === o.v;
        return (
          <button
            key={o.v}
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            onClick={() => pick(o.v)}
            className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
              on ? "bg-surface text-brand shadow-[var(--shadow-card)]" : "text-faint hover:text-ink"
            }`}
          >
            {o.icon}
          </button>
        );
      })}
    </div>
  );
}

const ico = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

function Sun() {
  return (
    <svg {...ico}>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.4v1.5M8 13.1v1.5M14.6 8h-1.5M2.9 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4 3.3 3.3" />
    </svg>
  );
}
function Moon() {
  return (
    <svg {...ico}>
      <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.9 5.9 0 1 0 7.1 7.1Z" />
    </svg>
  );
}
/** Half sun, half moon: whatever the machine says. */
function Auto() {
  return (
    <svg {...ico}>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 2.6a5.4 5.4 0 0 1 0 10.8Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
