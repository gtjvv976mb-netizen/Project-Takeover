"use client";

/**
 * An infinite marquee. The track holds the children twice and translates by
 * exactly -50%, so the loop is seamless with no measurement and no JS.
 * Hovering pauses it, which is also what makes the links inside clickable.
 */
export function Tape({
  children,
  speed = 34,
  reverse = false,
  className = "",
}: {
  children: React.ReactNode;
  speed?: number;
  reverse?: boolean;
  className?: string;
}) {
  return (
    <div className={`tape ${reverse ? "tape-rev" : ""} ${className}`} aria-hidden>
      <div className="tape-track" style={{ ["--speed" as string]: `${speed}s` }}>
        <div className="flex shrink-0">{children}</div>
        <div className="flex shrink-0">{children}</div>
      </div>
    </div>
  );
}
