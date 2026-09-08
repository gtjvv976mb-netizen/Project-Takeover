"use client";
import { useMemo } from "react";

/**
 * Artwork for a listing. If the token has a real image we show it. Otherwise we
 * generate a piece of art that is unique to the listing but deterministic, so a
 * project always looks the same and the grid is colourful even before anyone
 * uploads anything.
 */

const PALETTES: [string, string, string][] = [
  ["#7C5CFF", "#C4B5FD", "#FDE68A"],
  ["#10BFAE", "#7DE2D1", "#FDBA74"],
  ["#FF8A3D", "#FDBA74", "#A78BFA"],
  ["#3B82F6", "#93C5FD", "#F9A8D4"],
  ["#F43F6E", "#FDA4AF", "#FCD34D"],
  ["#17A66B", "#86EFAC", "#A5B4FC"],
  ["#8B5CF6", "#F0ABFC", "#67E8F9"],
  ["#F5A524", "#FCD34D", "#5EEAD4"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function coverAccent(seed: string): string {
  return PALETTES[hash(seed) % PALETTES.length][0];
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
  const art = useMemo(() => {
    const h = hash(seed);
    const [a, b, c] = PALETTES[h % PALETTES.length];
    const angle = h % 360;
    // three blobs placed from the hash, so every listing gets its own composition
    const blobs = [0, 1, 2].map((i) => ({
      cx: 12 + ((h >> (i * 5)) % 76),
      cy: 12 + ((h >> (i * 7 + 3)) % 76),
      r: 26 + ((h >> (i * 3 + 1)) % 26),
      fill: [a, b, c][i],
    }));
    return { a, b, c, angle, blobs };
  }, [seed]);

  return (
    <div className={`relative overflow-hidden ${rounded} ${className}`} style={{ background: `linear-gradient(${art.angle}deg, ${art.b}, ${art.c})` }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        {art.blobs.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill={b.fill} opacity={0.55 - i * 0.12} />
        ))}
      </svg>
      {/* a soft sheen so the art reads as glass rather than flat colour */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, rgba(255,255,255,.42), rgba(255,255,255,0) 46%)" }} />
      {image ? (
        <div className="absolute inset-0 grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt=""
            className="h-[58%] w-[58%] rounded-2xl border border-white/70 object-cover shadow-lg"
            loading="lazy"
          />
        </div>
      ) : symbol ? (
        <div className="absolute inset-0 grid place-items-center">
          <span className="rounded-2xl border border-white/60 bg-white/25 px-4 py-2 text-[clamp(14px,2.2vw,20px)] font-bold uppercase tracking-wide text-white drop-shadow">
            {symbol.slice(0, 5)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
