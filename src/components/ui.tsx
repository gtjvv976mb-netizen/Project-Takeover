"use client";
import Link from "next/link";
import { formatSol, STATUS_LABELS, TYPE_LABELS, type Listing, type ListingStatus } from "@/lib/types";

const STATUS_COLORS: Record<ListingStatus, string> = {
  draft: "text-mute border-line",
  active: "text-lime border-lime/50",
  paid: "text-amber border-amber/50",
  sold: "text-circuit border-circuit/50",
  cancelled: "text-mute border-line",
  disputed: "text-danger border-danger/50",
  refunded: "text-mute border-line",
};

export function StatusBadge({ status }: { status: ListingStatus }) {
  return <span className={`label rounded-sm border px-2 py-1 ${STATUS_COLORS[status]}`} style={{ color: "inherit" }}>{STATUS_LABELS[status]}</span>;
}

export function TypeBadge({ type }: { type: Listing["type"] }) {
  return <span className="label rounded-sm border border-line px-2 py-1">{TYPE_LABELS[type]}</span>;
}

export function TokenAvatar({ image, symbol, size = 48 }: { image?: string | null; symbol?: string | null; size?: number }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt={symbol ?? ""} width={size} height={size} className="rounded bg-ink-3 object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="flex items-center justify-center rounded bg-gradient-to-br from-ember/40 to-circuit/40 text-sm font-bold" style={{ width: size, height: size }}>
      {(symbol ?? "?").slice(0, 3)}
    </div>
  );
}

function tilt(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget, r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
  el.style.transform = `perspective(900px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-2px)`;
  el.style.boxShadow = `${-x * 20}px ${-y * 20}px 40px rgba(255,106,61,0.12)`;
}
function untilt(e: React.MouseEvent<HTMLElement>) { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }

export function ListingCard({ l }: { l: Listing }) {
  return (
    <Link href={`/listings/${l.id}`} onMouseMove={tilt} onMouseLeave={untilt} className="tilt hud group flex gap-4 rounded-sm border border-line bg-ink-2 p-4 hover:border-ember/50 hover:bg-ink-3">
      <TokenAvatar image={l.token?.image} symbol={l.token?.symbol ?? l.title} size={56} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold group-hover:text-ember">{l.title}</h3>
          <StatusBadge status={l.status} />
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-mute">{l.description || "No description"}</p>
        <div className="mt-2 flex items-center gap-2">
          <TypeBadge type={l.type} />
          {l.token?.symbol && <span className="text-xs text-white/50">${l.token.symbol}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-lg font-medium text-amber">{formatSol(l.priceLamports)} <span className="text-xs">SOL</span></div>
        <div className="text-xs text-white/40">{new Date(l.createdAt).toLocaleDateString()}</div>
      </div>
    </Link>
  );
}

export function Button({ children, variant = "primary", className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const base = "inline-flex items-center justify-center rounded-sm px-4 py-2 text-sm font-bold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px";
  const v = {
    primary: "bg-ember text-ink hover:bg-[#ff8a63]",
    secondary: "border border-line bg-transparent text-bone hover:border-bone/40 hover:bg-ink-3",
    danger: "border border-danger/50 bg-transparent text-danger hover:bg-danger/15",
  }[variant];
  return <button className={`${base} ${v} ${className}`} {...rest}>{children}</button>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="label mb-1.5">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-white/40">{hint}</div>}
    </label>
  );
}

export const inputCls = "w-full rounded-sm border border-line bg-ink px-3 py-2 text-sm text-bone outline-none focus:border-ember/70 placeholder:text-mute/60";

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "success" | "warn"; children: React.ReactNode }) {
  const c = { info: "border-circuit/30 bg-circuit/10 text-circuit", error: "border-danger/30 bg-danger/10 text-danger", success: "border-ember/30 bg-ember/10 text-ember", warn: "border-amber/30 bg-amber/10 text-amber" }[kind];
  return <div className={`rounded border px-3 py-2 text-sm ${c}`}>{children}</div>;
}
