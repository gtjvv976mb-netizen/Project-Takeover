"use client";

/**
 * A number whose digits flip when they change.
 *
 * Each digit is keyed by its own glyph, so React remounts it the moment the value
 * changes and the CSS enter animation plays. No refs read during render, no state,
 * and the animation is a transform inside an overflow-hidden box, so a nine-digit
 * counter updating every 400ms stays entirely on the compositor.
 */
export function Ticks({ value, className = "" }: { value: string; className?: string }) {
  return (
    <span className={`mono ${className}`}>
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex">
        {value.split("").map((ch, i) =>
          /\d/.test(ch) ? (
            <span key={`${i}-slot`} className="tick">
              <span key={ch} className="tick-roll">{ch}</span>
            </span>
          ) : (
            <span key={`${i}-sep`}>{ch}</span>
          ),
        )}
      </span>
    </span>
  );
}
