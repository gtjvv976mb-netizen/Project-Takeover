"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatSol, shortKey, STATUS_LABELS, TYPE_LABELS, type Listing, type ListingType } from "@/lib/types";
import { Button } from "@/components/ui";
import { Minimap } from "./Minimap";
import { PIER_ORDER, type HarborLayout, type Vessel } from "./layout";

/** Card that follows the cursor while a hull is hovered. Position comes from a ref,
 *  updated on an animation frame, so hovering never re-renders the tree. */
function HoverCard({ vessel, hoverRef }: { vessel: Vessel | null; hoverRef: React.MutableRefObject<{ x: number; y: number }> }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!vessel) return;
    let raf = 0;
    const tick = () => {
      if (el.current) {
        const { x, y } = hoverRef.current;
        const w = el.current.offsetWidth, h = el.current.offsetHeight;
        const left = Math.min(x + 18, window.innerWidth - w - 12);
        const top = Math.min(Math.max(y - h - 16, 12), window.innerHeight - h - 12);
        el.current.style.transform = `translate(${left}px, ${top}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [vessel, hoverRef]);

  if (!vessel) return null;
  const l = vessel.listing;
  return (
    <div ref={el} className="pointer-events-none fixed left-0 top-0 z-30 w-[250px] rounded-sm border bg-ink/95 p-3 backdrop-blur" style={{ borderColor: vessel.color + "77" }}>
      <div className="truncate text-sm font-semibold text-bone">{l.title}</div>
      <div className="label mt-1" style={{ color: vessel.color }}>{TYPE_LABELS[l.type]}</div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="font-mono text-base text-amber">{formatSol(l.priceLamports)} <span className="text-[10px]">SOL</span></span>
        <span className="label">{STATUS_LABELS[l.status]}</span>
      </div>
      <div className="label mt-2 !text-[9px]">click to board</div>
    </div>
  );
}

/** The panel that slides in when a vessel is selected. Two clicks from here to escrow. */
function BoardingPanel({ vessel, onClose }: { vessel: Vessel; onClose: () => void }) {
  const l = vessel.listing;
  const t = l.token;
  return (
    <aside className="hud pointer-events-auto absolute inset-x-2 bottom-2 z-20 max-h-[58vh] overflow-y-auto rounded-sm border border-line bg-ink/95 p-4 backdrop-blur sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-h-[70vh] sm:w-[330px]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="label" style={{ color: vessel.color }}>{TYPE_LABELS[l.type]}</div>
          <h2 className="mt-1 truncate text-lg font-bold text-bone">{l.title}</h2>
        </div>
        <button onClick={onClose} aria-label="Close" className="label rounded-sm border border-line px-2 py-1 hover:border-bone/40">esc</button>
      </div>

      <div className="mt-3 font-mono text-2xl text-amber">{formatSol(l.priceLamports)} <span className="text-sm">SOL</span></div>
      <div className="label mt-1">{STATUS_LABELS[l.status]} · berth {String(vessel.berth + 1).padStart(2, "0")}</div>

      {l.description && <p className="mt-3 line-clamp-4 text-sm text-mute">{l.description}</p>}

      {t && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line pt-3 font-mono text-[11px] text-bone/80">
          <dt className="text-mute">mint auth</dt><dd>{t.mintAuthority ? shortKey(t.mintAuthority, 4) : "revoked"}</dd>
          <dt className="text-mute">freeze</dt><dd>{t.freezeAuthority ? shortKey(t.freezeAuthority, 4) : "revoked"}</dd>
          {t.holders && (<><dt className="text-mute">top 10</dt><dd>{(t.holders.top10Share * 100).toFixed(1)}% of supply</dd></>)}
          {t.pump && (<><dt className="text-mute">pump.fun</dt><dd>{t.pump.complete ? "graduated" : "bonding curve"}</dd></>)}
        </dl>
      )}

      <div className="mt-3 border-t border-line pt-3">
        <div className="label mb-1">Built by</div>
        <Link href={`/builders/${l.seller}`} className="inline-flex items-center gap-2 text-sm text-bone hover:text-amber">
          <span className="inline-block h-3 w-3 rotate-45" style={{ background: vessel.color }} />
          {shortKey(l.seller, 5)}
        </Link>
      </div>

      <Link href={`/listings/${l.id}`} className="mt-4 block">
        <Button className="w-full">Board this vessel →</Button>
      </Link>
      <p className="label mt-2 !text-[9px]">the full manifest, escrow terms and the buy action live on the listing</p>
    </aside>
  );
}

export function HarborHUD({
  layout, listings, hovered, hoverRef, selected, dimmedIds, matches, query, setQuery,
  onPick, onClear, onOverview, pierColor,
}: {
  layout: HarborLayout;
  listings: Listing[];
  hovered: Vessel | null;
  hoverRef: React.MutableRefObject<{ x: number; y: number }>;
  selected: Vessel | null;
  dimmedIds: Set<string> | null;
  matches: Vessel[];
  query: string;
  setQuery: (v: string) => void;
  onPick: (v: Vessel) => void;
  onClear: () => void;
  onOverview: () => void;
  pierColor: Record<ListingType, string>;
}) {
  const [introGone, setIntroGone] = useState(false);
  useEffect(() => {
    const dismiss = () => setIntroGone(true);
    window.addEventListener("pointerdown", dismiss, { once: true });
    window.addEventListener("wheel", dismiss, { once: true, passive: true });
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("wheel", dismiss); };
  }, []);

  const empty = layout.vessels.length === 0;

  return (
    <>
      {/* title, fades on first interaction so the harbour is never hidden behind copy */}
      <div className={`pointer-events-none absolute left-4 top-24 z-10 max-w-[88vw] transition-opacity duration-700 sm:max-w-lg sm:top-20 md:left-8 ${introGone ? "opacity-0" : "opacity-100"}`}>
        <div className="label !text-amber">{"// the harbour is open"}</div>
        <h1 className="mt-2 text-[28px] font-bold leading-[1.06] tracking-tight text-bone sm:text-4xl md:text-6xl">
          Every project here<br />is a ship someone built.
        </h1>
        <p className="mt-3 max-w-md text-[13px] text-mute sm:mt-4 sm:text-sm md:text-base">
          Builders moor what they shipped. The chain proves who owns it. A buyer pays into the lock,
          the gate opens, and the ship sails out under new command.
        </p>
        <div className="label mt-5 hidden sm:block">drag to move · scroll to zoom · click a hull to board</div>
        <div className="label mt-4 sm:hidden">drag to move · pinch to zoom · tap a hull</div>
      </div>

      {/* search + legend */}
      <div className="pointer-events-auto absolute left-4 top-24 z-20 flex flex-col gap-2 transition-opacity duration-500 sm:top-20 md:left-8" style={{ opacity: introGone ? 1 : 0, pointerEvents: introGone ? "auto" : "none" }}>
        <div className="flex items-center gap-2">
          <input
            id="harbor-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && matches.length) onPick(matches[0]); }}
            placeholder="Search the harbour  /"
            className="w-44 rounded-sm border border-line bg-ink/90 sm:w-56 px-3 py-2 text-sm text-bone outline-none backdrop-blur placeholder:text-mute/60 focus:border-amber/70"
          />
          {query && <span className="label whitespace-nowrap">{matches.length} found</span>}
        </div>
        <div className="rounded-sm border border-line bg-ink/85 p-2 backdrop-blur">
          {PIER_ORDER.map((t, i) => {
            const n = layout.vessels.filter((v) => v.type === t).length;
            return (
              <div key={t} className="flex items-center gap-2 px-1 py-0.5">
                <span className="inline-block h-2 w-2" style={{ background: pierColor[t] }} />
                <span className="label !text-bone/75">Pier {i + 1} · {TYPE_LABELS[t]}</span>
                <span className="label ml-auto">{n}</span>
              </div>
            );
          })}
          {layout.anchorage.length > 0 && (
            <div className="flex items-center gap-2 border-t border-line px-1 pt-1.5 mt-1">
              <span className="inline-block h-2 w-2 bg-[#4a5f73]" />
              <span className="label !text-bone/75">Anchorage · taken over</span>
              <span className="label ml-auto">{layout.anchorage.length}</span>
            </div>
          )}
        </div>
      </div>

      {/* chart + camera controls */}
      <div className="pointer-events-auto absolute bottom-16 left-4 z-20 flex flex-col gap-2 md:left-8">
        <div className="hidden sm:block"><Minimap layout={layout} selectedId={selected?.listing.id ?? null} dimmedIds={dimmedIds} onPick={onPick} /></div>
        <div className="flex gap-2">
          <button onClick={onClear} className="label flex-1 rounded-sm border border-line bg-ink/85 px-2 py-1.5 backdrop-blur hover:border-bone/40">quay</button>
          <button onClick={onOverview} className="label flex-1 rounded-sm border border-line bg-ink/85 px-2 py-1.5 backdrop-blur hover:border-bone/40">chart</button>
          <Link href="/sell" className="label flex-1 rounded-sm border border-lime/50 bg-ink/85 px-2 py-1.5 text-center !text-lime backdrop-blur hover:bg-lime/10">list</Link>
        </div>
      </div>

      {/* empty harbour: honest, and pointing at the slipway */}
      {empty && (
        <div className="pointer-events-auto absolute bottom-4 right-4 z-20 w-[300px] rounded-sm border border-line bg-ink/95 p-4 backdrop-blur">
          <div className="label !text-lime">berths open</div>
          <p className="mt-2 text-sm text-mute">
            Every berth in this harbour is empty. The piers, the lock and the lighthouse all work.
            They are waiting for the first builder to moor something real.
          </p>
          <Link href="/sell" className="mt-3 block"><Button className="w-full">Launch the first ship</Button></Link>
        </div>
      )}

      {!empty && !selected && listings.length > 0 && (
        <div className="pointer-events-none absolute bottom-6 right-6 z-10 hidden text-right sm:block">
          <div className="font-mono text-3xl text-bone">{layout.vessels.length}</div>
          <div className="label">moored and for sale</div>
        </div>
      )}

      <HoverCard vessel={hovered} hoverRef={hoverRef} />
      {selected && <BoardingPanel vessel={selected} onClose={onClear} />}
    </>
  );
}
