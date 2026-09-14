"use client";
import { useState } from "react";
import { hash } from "@/lib/guilloche";

/**
 * A listing's picture.
 *
 * This used to draw a generated engraving whenever a listing had no picture of its own —
 * a guilloche rosette struck from the listing's id. It was nice to look at and it was a
 * lie: a wall of listings all wearing handsome artwork nobody made, where the one thing a
 * buyer wants to see is the actual project. Sellers left it in place precisely because it
 * did not look broken, so the market filled up with decoration.
 *
 * So the decoration is gone. A cover is now required when a listing is created, and the
 * order of preference is: the seller's own cover, then the token's own artwork for a coin
 * that has some, and otherwise a plain panel that reads as missing — which is the truth,
 * and which is what puts an "add a cover" prompt in front of a seller who skipped it.
 */

/** One colour per listing, used for borders and hover states around the site. */
const INKS: string[] = [
  "#6C4BF5", // grape
  "#2F8F62", // sage
  "#D65B2E", // clay
  "#2C6ECB", // ink blue
  "#B0407A", // mulberry
  "#177F86", // teal
  "#C07A16", // honey
  "#5B4BC4", // indigo
];

export function coverAccent(seed: string): string {
  return INKS[hash(seed) % INKS.length];
}

export function CoverArt({
  seed,
  image,
  symbol,
  banner,
  className = "",
  rounded = "rounded-t-[17px]",
}: {
  seed: string;
  /** A token's own artwork, from its metadata. Square, so it is shown whole, not cropped. */
  image?: string | null;
  symbol?: string | null;
  /** The seller's cover for this listing. It fills the frame — it was chosen for this. */
  banner?: string | null;
  className?: string;
  rounded?: string;
}) {
  const ink = coverAccent(seed);
  const frame = `relative overflow-hidden ${rounded} ${className}`;
  const ground = { background: `color-mix(in srgb, ${ink} 7%, var(--color-surface))` };

  /**
   * The picture that would not load, if one did not.
   *
   * Token artwork is whatever URL the coin's metadata points at, and that is usually a
   * public IPFS gateway — ipfs.io hands out 429s all day. A broken-image icon is worse
   * than the honest empty panel, and it was worse than the artwork this component stopped
   * drawing, so a failed load falls through to the panel instead. Held as the URL rather
   * than a flag so a replaced cover gets its own chance to load.
   */
  const [failed, setFailed] = useState<string | null>(null);
  const useBanner = banner && failed !== banner;
  const useImage = image && failed !== image;

  if (useBanner) {
    return (
      <div className={frame} style={ground}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy"
          onError={() => setFailed(banner)} />
      </div>
    );
  }

  // A coin's own artwork is square and usually a logo, so cropping it to a letterbox cuts
  // the logo in half. Blur a copy to fill the frame and sit the real thing on top of it.
  if (useImage) {
    return (
      <div className={frame} style={ground}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" aria-hidden loading="lazy"
          className="absolute inset-0 h-full w-full scale-110 object-cover"
          style={{ filter: "blur(22px) saturate(1.3)", opacity: 0.55 }} />
        <div className="absolute inset-0 grid place-items-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={symbol ?? ""} loading="lazy" onError={() => setFailed(image)}
            className="h-[76%] max-w-[58%] rounded-xl border border-line object-contain"
            style={{ boxShadow: "0 8px 24px color-mix(in srgb, var(--color-ink) 22%, transparent)", background: "var(--color-surface)" }} />
        </div>
      </div>
    );
  }

  return (
    <div className={`${frame} grid place-items-center border-b border-line`} style={ground}>
      <span className="px-4 text-center text-[12px] font-semibold uppercase tracking-[.12em] text-faint">
        {symbol ? `$${symbol.slice(0, 8)}` : "No cover image"}
      </span>
    </div>
  );
}
