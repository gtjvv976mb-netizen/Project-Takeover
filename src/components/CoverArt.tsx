"use client";
import { useId, useMemo } from "react";
import { hash, rosette } from "@/lib/guilloche";

/**
 * Artwork for a listing.
 *
 * This used to be a pastel mesh gradient with three soft blobs — the same picture every
 * marketplace and AI startup has shipped since 2023. It looked pleasant and said nothing:
 * swap it onto a different product and nobody would notice.
 *
 * It is now an engraved rosette, the guilloche you find on a share certificate or a
 * banknote. That is what a listing here actually is — a certificate of title — and the
 * pattern is struck from the asset's own seed, so it is a fingerprint of the thing being
 * sold rather than stock decoration. Two listings can never share a face.
 *
 * The signature is unchanged, so every call site keeps working untouched.
 */

/** One colour per rosette, drawn from the same family the categories use. */
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

/** The tint a listing is keyed to elsewhere in the UI (borders, hover states). */
export function coverAccent(seed: string): string {
  return INKS[hash(seed) % INKS.length];
}

export function CoverArt({
  seed,
  image,
  symbol,
  className = "",
  rounded = "rounded-t-[17px]",
}: {
  seed: string;
  image?: string | null;
  symbol?: string | null;
  className?: string;
  rounded?: string;
}) {
  const id = useId().replace(/:/g, "");
  const art = useMemo(() => {
    const h = hash(seed);
    const ink = INKS[h % INKS.length];
    // Each ring takes its gearing from a different slice of the hash, so listings whose
    // seeds share a prefix still come out visibly different.
    const rings = [0, 1, 2].map((i) => {
      const b = (h >> (i * 6)) & 0xff;
      const R = 88 - i * 16;
      const r = 7 + (b % 12) + i * 2;
      const d = 11 + ((b >> 3) % 24);
      return { d: rosette(R, r, d), w: 0.5 - i * 0.07, o: 0.9 - i * 0.18 };
    });
    return { ink, rings, angle: h % 360 };
  }, [seed]);

  return (
    <div
      className={`relative overflow-hidden ${rounded} ${className}`}
      style={{ background: `color-mix(in srgb, ${art.ink} 7%, var(--color-surface))` }}
    >
      <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <radialGradient id={`c${id}`} cx="50%" cy="44%" r="62%">
            <stop offset="0" stopColor={art.ink} stopOpacity="1" />
            <stop offset="1" stopColor={art.ink} stopOpacity="0.22" />
          </radialGradient>
        </defs>
        <g transform={`rotate(${art.angle} 100 100)`}>
          {art.rings.map((r, i) => (
            <path key={i} d={r.d} fill="none" stroke={`url(#c${id})`} strokeWidth={r.w} opacity={r.o} />
          ))}
        </g>
      </svg>

      {image ? (
        <div className="absolute inset-0 grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt=""
            className="h-[52%] w-[52%] rounded-xl border border-line object-cover"
            style={{ boxShadow: "3px 3px 0 color-mix(in srgb, var(--color-ink) 12%, transparent)" }}
            loading="lazy"
          />
        </div>
      ) : symbol ? (
        <div className="absolute inset-0 grid place-items-center">
          <span
            className="rounded-lg px-3 py-1.5 font-mono text-[clamp(12px,1.9vw,16px)] font-semibold uppercase tracking-[.1em]"
            style={{
              // mixing toward --color-ink lightens on dark and darkens on light
              color: `color-mix(in srgb, ${art.ink} 62%, var(--color-ink))`,
              background: "var(--color-surface)",
              border: `1.5px solid color-mix(in srgb, ${art.ink} 34%, transparent)`,
            }}
          >
            {symbol.slice(0, 5)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
