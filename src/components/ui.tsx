"use client";
import Link from "next/link";
import { formatSol, shortKey, STATUS_LABELS, TYPE_LABELS, type Listing, type ListingStatus, type ListingType } from "@/lib/types";
import { CoverArt } from "./CoverArt";

/* ------------------------------------------------------------- categories */

export const TYPE_TINT: Record<ListingType, string> = {
  token_authority: "var(--color-violet)",
  pump_creator: "var(--color-tangerine)",
  offchain: "var(--color-teal)",
};

/** Short, human labels. The long ones are for the detail page. */
export const TYPE_SHORT: Record<ListingType, string> = {
  token_authority: "Token controls",
  pump_creator: "pump.fun coin",
  offchain: "Project / site",
};

const STATUS_TINT: Record<ListingStatus, string> = {
  draft: "var(--color-faint)",
  active: "var(--color-green)",
  paid: "var(--color-amber)",
  sold: "var(--color-blue)",
  cancelled: "var(--color-faint)",
  disputed: "var(--color-rose)",
  refunded: "var(--color-faint)",
};

export function Pill({ children, tint, dot = false }: { children: React.ReactNode; tint?: string; dot?: boolean }) {
  return (
    <span className="pill" style={{ ["--tint" as string]: tint }}>
      {dot && <span className="pill-dot" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: ListingStatus }) {
  return <Pill tint={STATUS_TINT[status]} dot>{STATUS_LABELS[status]}</Pill>;
}

export function TypeBadge({ type, short = false }: { type: Listing["type"]; short?: boolean }) {
  return <Pill tint={TYPE_TINT[type]}>{short ? TYPE_SHORT[type] : TYPE_LABELS[type]}</Pill>;
}

export function Chip({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return <Pill tint={tint ?? "var(--color-muted)"}>{children}</Pill>;
}

/* ------------------------------------------------------------------ sigil */

export function Sigil({ wallet, size = 32 }: { wallet: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < wallet.length; i++) h = (h * 31 + wallet.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return (
    <span
      className="inline-block shrink-0 rounded-full border border-line"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(from ${h % 360}deg, hsl(${hue} 85% 68%), hsl(${(hue + 90) % 360} 85% 72%), hsl(${(hue + 200) % 360} 80% 70%), hsl(${hue} 85% 68%))`,
      }}
      aria-hidden
    />
  );
}

export function TokenAvatar({ image, symbol, size = 44 }: { image?: string | null; symbol?: string | null; size?: number }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt={symbol ?? ""} width={size} height={size}
      className="rounded-xl border border-line object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-xl border border-line bg-bg-2 text-[12px] font-bold uppercase text-muted"
      style={{ width: size, height: size }} aria-hidden>
      {(symbol ?? "?").slice(0, 3)}
    </span>
  );
}

/* ------------------------------------------------------------ listing card */

/**
 * The card that carries the market. Artwork on top, then the name, a short
 * description, the proof chips a buyer actually checks, and the price.
 */
export function ListingCard({ l }: { l: Listing }) {
  const t = l.token;
  const tint = TYPE_TINT[l.type];
  const revoked = t ? !t.mintAuthority && !t.freezeAuthority : false;
  return (
    <Link
      href={`/listings/${l.id}`}
      className="card card-hover group flex flex-col overflow-hidden"
      style={{ ["--accent" as string]: tint }}
    >
      <CoverArt seed={l.id} image={t?.image} symbol={t?.symbol} className="aspect-[16/10] w-full" />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeBadge type={l.type} short />
          <StatusBadge status={l.status} />
        </div>

        <div>
          <h3 className="text-[19px] font-bold leading-snug text-ink transition-colors group-hover:text-brand">
            {l.title}
          </h3>
          <p className="clamp-2 mt-1 text-[14px] leading-relaxed text-muted">
            {l.description || "No description yet."}
          </p>
        </div>

        {(t?.symbol || revoked || t?.pump?.complete || t?.holders) && (
          <div className="flex flex-wrap gap-1.5">
            {t?.symbol && <Chip>${t.symbol}</Chip>}
            {revoked && <Chip tint="var(--color-blue)">Authorities revoked</Chip>}
            {t?.pump?.complete && <Chip tint="var(--color-blue)">Graduated</Chip>}
            {t?.holders && (
              <Chip tint={t.holders.top10Share > 0.5 ? "var(--color-rose)" : "var(--color-green)"}>
                Top 10 hold {(t.holders.top10Share * 100).toFixed(0)}%
              </Chip>
            )}
          </div>
        )}

        <div className="mt-auto flex items-end justify-between border-t border-line pt-3">
          <div>
            <div className="kicker mb-1">Price</div>
            <div className="price">
              {formatSol(l.priceLamports)} <span className="text-[13px] font-semibold text-muted">SOL</span>
            </div>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold transition-all group-hover:gap-2.5"
            style={{ background: `color-mix(in srgb, ${tint} 12%, var(--color-tint-base))`, color: `color-mix(in srgb, ${tint} 80%, var(--color-ink))` }}
          >
            View <span aria-hidden>→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Compact horizontal variant for dashboards and builder pages. */
export function ListingRow({ l }: { l: Listing; rank?: number }) {
  return <ListingCard l={l} />;
}

/* ---------------------------------------------------------------- controls */

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const v = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    danger: "btn-danger",
    ghost: "btn-ghost",
  }[variant];
  return (
    <button className={`btn ${v} disabled:cursor-not-allowed disabled:opacity-45 ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[14px] font-semibold text-ink">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[13px] text-faint">{hint}</div>}
    </label>
  );
}

export const inputCls = "input";

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "success" | "warn"; children: React.ReactNode }) {
  const tint = { info: "var(--color-blue)", error: "var(--color-rose)", success: "var(--color-green)", warn: "var(--color-amber)" }[kind];
  return (
    <div
      className="rounded-xl border px-3.5 py-3 text-[14px] leading-relaxed"
      style={{
        background: `color-mix(in srgb, ${tint} 7%, var(--color-tint-base))`,
        borderColor: `color-mix(in srgb, ${tint} 28%, var(--color-tint-base))`,
        color: "var(--color-ink)",
      }}
    >
      {children}
    </div>
  );
}

export function Stat({ value, label, tint }: { value: React.ReactNode; label: string; tint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[clamp(24px,3vw,34px)] font-bold leading-none text-ink" style={tint ? { color: tint } : undefined}>
        {value}
      </div>
      <div className="kicker mt-2">{label}</div>
    </div>
  );
}

export { shortKey };
