"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

/**
 * What an iPhone needs to be told, once.
 *
 * Two facts about iOS that the site cannot change. First, Safari has no wallet
 * extensions, so on a phone the only way to connect Phantom is to open the site inside
 * Phantom's own browser — and Phantom publishes a universal link that does exactly that.
 * Without it, "Select Wallet" on an iPhone opens an empty list and the visitor concludes
 * the site is broken. Second, there is no install prompt: the app arrives on the home
 * screen only when the visitor taps Share → Add to Home Screen, and nothing tells them
 * that unless the page does.
 *
 * So this shows on iOS, in a browser, when no wallet has registered itself: one line for
 * each fact, dismissable, and never again once dismissed. Inside Phantom's browser, or once
 * installed, or on a desktop, it renders nothing.
 */
const KEY = "takeover-phone-hint";

export function PhoneHint() {
  const { wallets } = useWallet();
  const [state, setState] = useState<"unknown" | "hide" | "show">("unknown");

  useEffect(() => {
    // Everything here is about the device, which the server cannot see, so it is decided
    // once on the client rather than rendered from a guess.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((() => {
      try { if (localStorage.getItem(KEY)) return "hide"; } catch { /* private mode */ }
      const ua = navigator.userAgent;
      const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (!ios) return "hide";
      const standalone = window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
      // Phantom's in-app browser registers a wallet; Safari never will.
      const hasWallet = wallets.length > 0 || /Phantom/i.test(ua);
      return standalone || hasWallet ? "hide" : "show";
    })());
  }, [wallets.length]);

  if (state !== "show") return null;

  const here = typeof window !== "undefined" ? window.location.href : "https://project-takeover.com/";
  const origin = typeof window !== "undefined" ? window.location.origin : "https://project-takeover.com";
  // Phantom's documented universal link: opens the URL inside the Phantom app's browser,
  // where the wallet is available to the page.
  const phantom = `https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(origin)}`;

  const dismiss = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ }
    setState("hide");
  };

  return (
    <div className="border-b border-line px-4 py-3 text-[13.5px]" style={{ background: "color-mix(in srgb, var(--color-brand) 8%, var(--color-tint-base))" }}>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-ink">
          <strong>On an iPhone?</strong>{" "}
          <a href={phantom} className="font-semibold underline underline-offset-2" style={{ color: "var(--color-brand)" }}>Open in Phantom</a>{" "}
          to connect a wallet, or tap Share → <strong>Add to Home Screen</strong> to keep this as an app.
        </span>
        <button onClick={dismiss} className="ml-auto text-muted hover:text-ink" aria-label="Dismiss">✕</button>
      </div>
    </div>
  );
}
