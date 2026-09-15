"use client";
import { useEffect, useState } from "react";
import { inPhantomBrowser, isIOS, isStandalone } from "@/lib/client/phantom-deeplink";

/**
 * What an iPhone needs to be told, once.
 *
 * In Safari, connecting a wallet works by hopping to the Phantom app and back, one
 * approval at a time (lib/client/phantom-deeplink.ts). That is unusual enough to say out
 * loud, along with the two alternatives: Phantom's own browser, where the wallet is simply
 * there, and Add to Home Screen, which nothing else on the phone will ever mention.
 *
 * Installed to the home screen, the hop cannot come back: Apple opens Phantom's reply in
 * Safari, whose storage the installed app does not share. So there the banner says the
 * honest thing — use Phantom's browser or Safari for anything that needs a signature.
 *
 * Inside Phantom's browser, or on a desktop, it renders nothing. Each version is
 * dismissable and stays dismissed.
 */
const KEY = "takeover-phone-hint";

export function PhoneHint() {
  const [state, setState] = useState<"unknown" | "hide" | "browser" | "standalone">("unknown");

  useEffect(() => {
    // Everything here is about the device, which the server cannot see, so it is decided
    // once on the client rather than rendered from a guess.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((() => {
      if (!isIOS() || inPhantomBrowser()) return "hide";
      const variant = isStandalone() ? "standalone" : "browser";
      try { if (localStorage.getItem(`${KEY}:${variant}`)) return "hide"; } catch { /* private mode */ }
      return variant;
    })());
  }, []);

  if (state === "unknown" || state === "hide") return null;

  const here = window.location.href;
  const origin = window.location.origin;
  // Phantom's documented universal link: opens the URL inside the Phantom app's browser,
  // where the wallet is available to the page.
  const phantom = `https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(origin)}`;
  const link = (label: string) => (
    <a href={phantom} className="font-semibold underline underline-offset-2" style={{ color: "var(--color-brand)" }}>{label}</a>
  );

  const dismiss = () => {
    try { localStorage.setItem(`${KEY}:${state}`, "1"); } catch { /* private mode */ }
    setState("hide");
  };

  return (
    <div className="border-b border-line px-4 py-3 text-[13.5px]" style={{ background: "color-mix(in srgb, var(--color-brand) 8%, var(--color-tint-base))" }}>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-ink">
          {state === "browser" ? (
            <>
              <strong>On an iPhone?</strong> Connecting a wallet hops to the Phantom app and back, one approval at a time.
              For everything in one place, {link("open in Phantom")}. Tap Share → <strong>Add to Home Screen</strong> to keep this as an app.
            </>
          ) : (
            <>
              <strong>Wallets can&apos;t connect from a home-screen app on iPhone.</strong> Apple sends Phantom&apos;s reply to Safari instead of here.
              {" "}{link("Open in Phantom")} or use Safari when you need to buy, sell or sign.
            </>
          )}
        </span>
        <button onClick={dismiss} className="ml-auto text-muted hover:text-ink" aria-label="Dismiss">✕</button>
      </div>
    </div>
  );
}
