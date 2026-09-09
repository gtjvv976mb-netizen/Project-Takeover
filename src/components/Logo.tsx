"use client";
import { useId } from "react";

/**
 * "Lights On" — the mark for Project: Takeover.
 *
 * An 8-bit ghost: the empty shell of a project whose developer walked away. It is drawn
 * as a hollow outline, except it is filling back up from the bottom like a health bar
 * reloading, and the eyes are lit. The dev ghosted; the ghost got a new tenant.
 *
 * The silhouette is deliberately the most recognisable shape in games, so it survives
 * being 16 pixels wide in a browser tab.
 */

/** Dome, straight flanks, four feet. Traced once and shared by every variant. */
const GHOST =
  "M6 16.4a10 10 0 0 1 20 0V27l-3.33-3.1L19.33 27 16 23.9 12.67 27 9.33 23.9 6 27Z";

export function Logo({
  size = 32,
  className = "",
  /** How far the shell has refilled, 0 to 1. Animated on hover in the header. */
  fill = 0.52,
  title,
}: {
  size?: number;
  className?: string;
  fill?: number;
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  // The ghost spans y 6.4 → 27; the fill line rises from the feet toward the dome.
  const top = 27 - (27 - 6.4) * fill;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={`lg${id}`} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-brand, #7C5CFF)" />
          <stop offset="1" stopColor="var(--color-teal, #10BFAE)" />
        </linearGradient>
        {/* everything below the fill line is solid; above it stays an empty shell */}
        <clipPath id={`cp${id}`}>
          <rect x="0" y={top} width="32" height={32 - top} />
        </clipPath>
      </defs>

      {/* the husk the last owner left behind */}
      <path d={GHOST} stroke={`url(#lg${id})`} strokeWidth="2.6" strokeLinejoin="round" />
      {/* refilling under new ownership */}
      <g clipPath={`url(#cp${id})`}>
        <path d={GHOST} fill={`url(#lg${id})`} />
      </g>
      {/* lights on */}
      <circle cx="12.4" cy="14.6" r="2.35" fill={`url(#lg${id})`} />
      <circle cx="19.6" cy="14.6" r="2.35" fill={`url(#lg${id})`} />
    </svg>
  );
}

/**
 * Solid variant for tiny or single-colour contexts — favicons, app icons, anywhere the
 * hollow shell would turn to mush. Same silhouette, eyes knocked out.
 */
export function LogoSolid({ size = 32, className = "", color }: { size?: number; className?: string; color?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={`ls${id}`} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-brand, #7C5CFF)" />
          <stop offset="1" stopColor="var(--color-teal, #10BFAE)" />
        </linearGradient>
        <mask id={`lm${id}`}>
          <rect width="32" height="32" fill="#000" />
          <path d={GHOST} fill="#fff" />
          <circle cx="12.4" cy="14.6" r="2.6" fill="#000" />
          <circle cx="19.6" cy="14.6" r="2.6" fill="#000" />
        </mask>
      </defs>
      <rect width="32" height="32" fill={color ?? `url(#ls${id})`} mask={`url(#lm${id})`} />
    </svg>
  );
}
