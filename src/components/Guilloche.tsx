"use client";
import { useId, useMemo } from "react";

/**
 * The engraved rosette on a share certificate or a banknote.
 *
 * It replaces the pastel mesh gradient every marketplace uses for artwork. A mesh
 * gradient is decoration — it says nothing and could belong to any product. This says
 * "certificate of title", which is literally what a listing is, and it is drawn from the
 * mint address, so the pattern is a fingerprint of the asset rather than a stock image.
 *
 * The curve is a hypotrochoid: a small circle rolling inside a large one with a pen at
 * some offset. Real guilloche machines were geared exactly this way, which is why the
 * output reads as engraving instead of as computer art.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One rolling-circle curve, sampled densely enough that the moiré is smooth. */
function rosette(R: number, r: number, d: number, turns: number, cx: number, cy: number): string {
  const pts: string[] = [];
  const steps = Math.ceil(turns * 240);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * Math.PI * 2;
    const k = (R - r) / r;
    const x = cx + (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = cy + (R - r) * Math.sin(t) - d * Math.sin(k * t);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return "M" + pts.join("L");
}

export function Guilloche({
  seed,
  tint = "var(--color-brand)",
  className = "",
  /** Rings to draw. Three reads as engraving; more turns to mush at small sizes. */
  rings = 3,
}: {
  seed: string;
  tint?: string;
  className?: string;
  rings?: number;
}) {
  const id = useId().replace(/:/g, "");
  const paths = useMemo(() => {
    const h = hash(seed);
    // Every parameter is drawn from a different byte of the hash, so two mints that
    // share a prefix still produce visibly different rosettes.
    return Array.from({ length: rings }, (_, i) => {
      const b = (h >> (i * 5)) & 0xff;
      const R = 92 - i * 17;
      const r = 7 + (b % 11) + i * 2;
      const d = 10 + ((b >> 3) % 26);
      // Turns must cover R/gcd(R,r) revolutions to close the figure; this over-shoots
      // slightly on purpose so the ends overlap and the seam disappears.
      const turns = r / gcd(Math.round(R), r) + 0.5;
      return { d: rosette(R, r, d, turns, 100, 100), w: 0.45 - i * 0.06, o: 0.85 - i * 0.16 };
    });
  }, [seed, rings]);

  return (
    <svg viewBox="0 0 200 200" className={className} fill="none" aria-hidden>
      <defs>
        <radialGradient id={`g${id}`} cx="50%" cy="42%" r="62%">
          <stop offset="0" stopColor={tint} stopOpacity="1" />
          <stop offset="1" stopColor={tint} stopOpacity="0.25" />
        </radialGradient>
      </defs>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={`url(#g${id})`} strokeWidth={p.w} opacity={p.o} strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
