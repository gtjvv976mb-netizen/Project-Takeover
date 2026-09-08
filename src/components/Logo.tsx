/** Takeover mark: a target bracket with a transfer arrow punching out of it. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M3 11V3h8M21 3h8v8M29 21v8h-8M11 29H3v-8" stroke="var(--color-ember)" strokeWidth="2.5" strokeLinecap="square" />
      <path d="M10 22 22 10M13 10h9v9" stroke="var(--color-bone)" strokeWidth="3" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}
