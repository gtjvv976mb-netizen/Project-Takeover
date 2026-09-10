/**
 * The geometry behind the site's artwork.
 *
 * A guilloche is the engraved rosette on a share certificate or a banknote, cut by a
 * lathe with two geared wheels. The curve those machines trace is a hypotrochoid — a
 * small circle rolling inside a large one with a pen at some offset — which is why
 * plotting the same equation reads as engraving rather than as computer art.
 *
 * Shared by the listing artwork and the seal behind the hero so the two can never drift
 * apart, and so the maths lives in one place.
 */

/** FNV-1a. Stable across runs, so an asset keeps the same face forever. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/**
 * One closed rosette as an SVG path.
 *
 * `R` is the fixed outer wheel, `r` the rolling one and `d` the pen's offset from its
 * centre. The figure closes after r/gcd(R,r) revolutions, so that is exactly how far it
 * is drawn — further would retrace the same line and cost points for nothing.
 */
export function rosette(R: number, r: number, d: number, cx = 100, cy = 100, samples = 260): string {
  const turns = r / gcd(Math.round(R), r);
  const steps = Math.ceil(turns * samples);
  const k = (R - r) / r;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * Math.PI * 2;
    pts.push(
      `${(cx + (R - r) * Math.cos(t) + d * Math.cos(k * t)).toFixed(2)},` +
      `${(cy + (R - r) * Math.sin(t) - d * Math.sin(k * t)).toFixed(2)}`,
    );
  }
  return "M" + pts.join("L");
}
