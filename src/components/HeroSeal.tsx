"use client";

/**
 * What sits behind the hero.
 *
 * It used to be three blurred colour fields drifting past each other — the aurora that
 * every AI company has shipped since 2023. Pretty, anonymous, and lifted straight from
 * the same template as everyone else's.
 *
 * This is the same engraved rosette the listings wear, struck once at wall size and left
 * to turn very slowly. The background now belongs to this product instead of to a trend,
 * and it is the brand's own geometry rather than a stock texture.
 */

import { rosette } from "@/lib/guilloche";

/** Half the viewBox: the seal is struck about its own centre. */
const C = 300;

// Fixed gearing: this one is the house mark, not a per-listing fingerprint, so it is
// computed once at module load rather than per render.
const RINGS = [
  { d: rosette(286, 17, 34, C, C, 300), w: 1.0, o: 0.50 },
  { d: rosette(232, 13, 27, C, C, 300), w: 0.8, o: 0.38 },
  { d: rosette(178, 23, 21, C, C, 300), w: 0.7, o: 0.28 },
];

export function HeroSeal() {
  return (
    <div className="hero-seal" aria-hidden>
      <svg viewBox="0 0 600 600" fill="none">
        <defs>
          <radialGradient id="heroSealInk" cx="50%" cy="50%" r="58%">
            <stop offset="0" stopColor="var(--color-brand)" stopOpacity="0.9" />
            <stop offset=".62" stopColor="var(--color-teal)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--color-tangerine)" stopOpacity="0.12" />
          </radialGradient>
        </defs>
        <g className="hero-seal-spin">
          {RINGS.map((r, i) => (
            <path key={i} d={r.d} stroke="url(#heroSealInk)" strokeWidth={r.w} opacity={r.o} />
          ))}
        </g>
      </svg>
    </div>
  );
}
