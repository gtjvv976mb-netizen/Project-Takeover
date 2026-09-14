"use client";
import { formatSol, type Reputation, type Review } from "@/lib/types";
import { shortKey } from "@/components/ui";

/** Five characters, filled to the nearest half. Small enough to sit inline anywhere. */
export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - i));
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 20 20" aria-hidden>
            <defs>
              <linearGradient id={`s${i}-${Math.round(rating * 10)}`}>
                <stop offset={`${fill * 100}%`} stopColor="var(--color-honey)" />
                <stop offset={`${fill * 100}%`} stopColor="var(--color-line-2)" />
              </linearGradient>
            </defs>
            <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9 4.8 17.6l1-5.8L1.5 7.7l5.9-.9z"
              fill={`url(#s${i}-${Math.round(rating * 10)})`} />
          </svg>
        );
      })}
    </span>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "warn" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2 first:border-t-0">
      <span className="text-[13.5px] text-muted">{label}</span>
      <span className="text-[14px] font-semibold"
        style={{ color: tone === "warn" ? "var(--color-rose)" : tone === "good" ? "var(--color-green)" : "var(--color-ink)" }}>
        {value}
      </span>
    </div>
  );
}

/**
 * A wallet's record.
 *
 * Deliberately shows the bad rows too. A seller with four sales and two refunds is a
 * different proposition from one with four sales, and a reputation that only counts the
 * good outcomes is a marketing page rather than a record.
 */
export function ReputationPanel({ rep }: { rep: Reputation }) {
  const nothing = rep.soldCount + rep.boughtCount + rep.refundedAgainst === 0;
  return (
    <div className="card p-5">
      <h2 className="text-[16px] font-bold text-ink">Track record</h2>

      {rep.averageRating !== null ? (
        <div className="mt-2 flex items-center gap-2">
          <Stars rating={rep.averageRating} size={16} />
          <span className="text-[15px] font-bold text-ink">{rep.averageRating.toFixed(1)}</span>
          <span className="text-[13px] text-muted">from {rep.ratingCount} {rep.ratingCount === 1 ? "review" : "reviews"}</span>
        </div>
      ) : (
        <p className="mt-2 text-[13.5px] text-muted">No reviews yet.</p>
      )}

      {nothing ? (
        <p className="mt-3 text-[13.5px] text-faint">
          No settled deals. Everything on this panel comes from escrow that actually paid out,
          so it stays empty until one does.
        </p>
      ) : (
        <div className="mt-3">
          <Row label="Sold" value={rep.soldCount} />
          {rep.commissionsDelivered > 0 && <Row label="Commissions delivered" value={rep.commissionsDelivered} tone="good" />}
          <Row label="Bought" value={rep.boughtCount} />
          {rep.earnedLamports > 0 && <Row label="Earned" value={`${formatSol(rep.earnedLamports)} SOL`} />}
          {rep.spentLamports > 0 && <Row label="Spent" value={`${formatSol(rep.spentLamports)} SOL`} />}
          {rep.refundedAgainst > 0 && <Row label="Refunded to buyers" value={rep.refundedAgainst} tone="warn" />}
          {rep.disputedAgainst > 0 && <Row label="In dispute" value={rep.disputedAgainst} tone="warn" />}
        </div>
      )}

      <p className="mt-3 text-[12.5px] leading-snug text-faint">
        Every number here traces to a settled escrow. Reviews can only be written by the two
        people in a deal, once it has closed.
      </p>
    </div>
  );
}

export function ReviewList({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-[18px] font-bold text-ink">Reviews</h2>
      {reviews.map((r) => (
        <div key={r.id} className="card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Stars rating={r.rating} />
            <span className="text-[13px] text-muted">
              as {r.role} · from <span className="mono">{shortKey(r.reviewer, 4)}</span>
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-body">{r.body}</p>
        </div>
      ))}
    </section>
  );
}
