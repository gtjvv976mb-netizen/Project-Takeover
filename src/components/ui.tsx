"use client";
import Link from "next/link";
import { formatSol, shortKey, STATUS_LABELS, TYPE_LABELS, type Listing, type ListingStatus } from "@/lib/types";

/* ------------------------------------------------------------------ badges */

const STATUS_STYLE: Record<ListingStatus, string> = {
  draft: "border-rule-soft text-mute",
  active: "border-rule text-ink",
  paid: "border-flare-ink text-flare-ink",
  sold: "border-ultra text-ultra",
  cancelled: "border-rule-soft text-faint",
  disputed: "border-danger text-danger",
  refunded: "border-rule-soft text-mute",
};

export function StatusBadge({ status }: { status: ListingStatus }) {
  return (
    <span className={`t-chip inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-[0.14em] ${STATUS_STYLE[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function TypeBadge({ type }: { type: Listing["type"] }) {
  return (
    <span className="t-chip inline-block border border-rule-soft px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-mute">
      {TYPE_LABELS[type]}
    </span>
  );
}

/** Small square proof chip: the things a buyer actually checks. */
export function Chip({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "verified" | "warn" }) {
  const t = tone === "verified" ? "border-ultra text-ultra" : tone === "warn" ? "border-flare-ink text-flare-ink" : "border-rule-soft text-mute";
  return <span className={`t-chip inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-[0.14em] ${t}`}>{children}</span>;
}

/* ------------------------------------------------------- deterministic mark */

/** A builder's sigil: four squares derived from the wallet, so it is recognisable and never random. */
export function Sigil({ wallet, size = 28 }: { wallet: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < wallet.length; i++) h = (h * 31 + wallet.charCodeAt(i)) >>> 0;
  const cells = [0, 1, 2, 3].map((i) => (h >> (i * 3)) & 7);
  const colors = ["var(--color-ink)", "var(--color-flare)", "var(--color-ultra)", "var(--color-hi)"];
  return (
    <span className="inline-grid shrink-0 grid-cols-2 border border-rule" style={{ width: size, height: size }} aria-hidden>
      {cells.map((c, i) => <span key={i} style={{ background: colors[c % colors.length] }} />)}
    </span>
  );
}

/** Token art, framed like a printed plate: a hard 1px box, no radius, no glow. */
export function TokenAvatar({ image, symbol, size = 48 }: { image?: string | null; symbol?: string | null; size?: number }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt={symbol ?? ""} width={size} height={size}
      className="border border-rule object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex items-center justify-center border border-rule bg-paper-2 font-display text-[13px] uppercase"
      style={{ width: size, height: size }} aria-hidden>
      {(symbol ?? "?").slice(0, 3)}
    </span>
  );
}

/* ----------------------------------------------------------- listing entry */

/**
 * The index row. This is the site's signature: at rest an editorial entry on a
 * hairline; on hover or keyboard focus a black bar wipes across and takes it over.
 */
export function ListingRow({ l, rank }: { l: Listing; rank?: number }) {
  const t = l.token;
  const revoked = t ? !t.mintAuthority && !t.freezeAuthority : false;
  return (
    <Link
      href={`/listings/${l.id}`}
      className="takeover group grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 border-b border-rule px-3 py-4 sm:grid-cols-[3.5rem_1fr_auto] sm:gap-x-6 sm:px-4"
    >
      <span className="t-rank hidden font-display text-[40px] leading-none text-rule-soft sm:block">
        {String(rank ?? 0).padStart(2, "0")}
      </span>
      <span className="min-w-0">
        <span className="t-title block truncate font-display text-[22px] uppercase leading-[1.05] tracking-tight sm:text-[30px]">
          {l.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TypeBadge type={l.type} />
          <StatusBadge status={l.status} />
          {t?.symbol && <Chip>${t.symbol}</Chip>}
          {revoked && <Chip tone="verified">auth revoked</Chip>}
          {t?.pump?.complete && <Chip tone="verified">graduated</Chip>}
          {t?.holders && t.holders.top10Share > 0.5 && <Chip tone="warn">top 10 {(t.holders.top10Share * 100).toFixed(0)}%</Chip>}
        </span>
      </span>
      <span className="flex items-baseline gap-3 justify-self-end">
        <span className="t-price price whitespace-nowrap">
          {formatSol(l.priceLamports)}
          <span className="ml-1 font-mono text-[11px] tracking-widest">SOL</span>
        </span>
        <span className="t-arrow font-display text-[26px] text-paper">→</span>
      </span>
    </Link>
  );
}

/** Kept for pages that still lay out in a grid. */
export function ListingCard({ l }: { l: Listing }) {
  return <ListingRow l={l} />;
}

/* ----------------------------------------------------------------- buttons */

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const base =
    "takeover inline-flex items-center justify-center gap-2 border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const v = {
    primary: "takeover-flare border-ink bg-ink text-paper hover:text-paper",
    secondary: "border-rule bg-transparent text-ink hover:text-paper",
    danger: "border-danger bg-transparent text-danger hover:text-paper",
  }[variant];
  return <button className={`${base} ${v} ${className}`} {...rest}>{children}</button>;
}

/* ------------------------------------------------------------------ fields */

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="kicker mb-2">{label}</div>
      {children}
      {hint && <div className="micro mt-1.5 text-faint">{hint}</div>}
    </label>
  );
}

export const inputCls =
  "w-full border border-rule bg-paper-2 px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-faint focus:bg-paper focus:ring-0";

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "success" | "warn"; children: React.ReactNode }) {
  const c = {
    info: "border-ultra text-ink",
    error: "border-danger text-danger",
    success: "border-ink bg-hi text-ink",
    warn: "border-flare-ink text-ink",
  }[kind];
  return <div className={`border-l-[3px] border-y border-r border-rule-soft px-3 py-2.5 text-[14px] ${c}`}>{children}</div>;
}

/** Big editorial statistic. */
/** Big editorial statistic. `on` says what it sits on, so the kicker stays legible. */
export function Stat({
  value,
  label,
  on = "paper",
}: {
  value: React.ReactNode;
  label: string;
  on?: "paper" | "flare" | "ink";
}) {
  const valueTone = on === "ink" ? "text-flare" : "text-ink";
  const labelTone = on === "paper" ? "text-mute" : on === "flare" ? "text-ink/70" : "text-paper/55";
  const ruleTone = on === "ink" ? "border-paper/25" : "border-ink/25";
  return (
    <div className={`border-t pt-3 ${ruleTone}`}>
      <div className={`font-display text-[clamp(34px,4.4vw,58px)] leading-[0.85] ${valueTone}`}>{value}</div>
      <div className={`kicker mt-2 ${labelTone}`}>{label}</div>
    </div>
  );
}

export { shortKey };
